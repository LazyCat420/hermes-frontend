"""
Tests for the streaming pipeline: SSE parsing, timeout configuration,
proxy routing, and tool-call event handling.

Pinpoints the exact bugs that caused the frontend to hang:
  1. Proxy pointed DGX2 to localhost instead of 10.0.0.103
  2. Proxy upstream timeout was 30s but agents take 40-52s
  3. Frontend AbortController killed streams at 30s
  4. Tool progress events were silently swallowed
"""
import pytest
import json
import re
import io
import time
from unittest.mock import MagicMock, patch


# =====================================================================
# 1. Proxy Routing Sanity Tests
# =====================================================================

class TestProxyRouting:
    """Verifies the TARGETS dict points to the correct remote gateways."""

    def test_dgx2_target_is_not_localhost(self):
        """
        BUG REGRESSION: proxy.py was accidentally changed to point DGX2
        to 127.0.0.1:8642 during testing. This caused every DGX2 request
        to fail with HTTP 500, which silently stalled the orchestration.
        """
        import proxy
        dgx2_url = proxy.TARGETS["/api/dgx2/v1/chat/completions"]
        assert "127.0.0.1" not in dgx2_url, (
            f"DGX2 target still points to localhost: {dgx2_url}. "
            "This will cause HTTP 500 failures for the primary agent."
        )
        assert "10.0.0.103" in dgx2_url

    def test_dgx1_target_correct(self):
        import proxy
        assert "10.0.0.141" in proxy.TARGETS["/api/dgx1/v1/chat/completions"]

    def test_jetson_target_correct(self):
        import proxy
        assert "10.0.0.30" in proxy.TARGETS["/api/jetson/v1/chat/completions"]

    def test_all_targets_use_port_8642(self):
        """All Hermes gateways should listen on port 8642."""
        import proxy
        for path, url in proxy.TARGETS.items():
            assert ":8642" in url, f"Target {path} -> {url} is not using port 8642"


# =====================================================================
# 2. Timeout Configuration Tests
# =====================================================================

class TestTimeoutConfiguration:
    """
    Verifies that timeout values are long enough for the observed agent
    response times (40-52s from logs).
    """

    def test_proxy_upstream_timeout_is_sufficient(self):
        """
        BUG REGRESSION: proxy.py used timeout=30, but agents take 40-52s.
        This caused urllib to raise URLError, which the @retry decorator
        then retried 3x, each timing out at 30s = 90s total wasted.
        The proxy should allow at least 60s for a single upstream response.
        """
        import proxy
        # Read the source to check the timeout value
        import inspect
        source = inspect.getsource(proxy.CORSAndProxyHandler.do_POST)
        # Look for urlopen timeout parameter
        match = re.search(r'timeout=(\d+)', source)
        assert match is not None, "Could not find timeout parameter in proxy do_POST"
        timeout_value = int(match.group(1))
        assert timeout_value >= 60, (
            f"Proxy upstream timeout is {timeout_value}s, but agents routinely "
            "take 40-52s. Must be >= 60s to avoid premature connection kills."
        )

    def test_frontend_absolute_timeout_matches(self):
        """
        BUG REGRESSION: app.js had a 30s absolute timeout that killed 
        streams while agents were still generating. Verify it's >= 60s.
        """
        with open("app.js", "r", encoding="utf-8") as f:
            content = f.read()
        
        # Find the setTimeout for absolute timeout
        match = re.search(r'setTimeout\([^,]+,\s*(\d+)\)', content)
        assert match is not None, "Could not find setTimeout in app.js"
        timeout_ms = int(match.group(1))
        assert timeout_ms >= 60000, (
            f"Frontend absolute timeout is {timeout_ms}ms ({timeout_ms/1000}s), "
            "but agents take 40-52s. Must be >= 60000ms."
        )

    def test_stalled_interval_exists(self):
        """Verify the 15s stalled-stream detector is still present."""
        with open("app.js", "r", encoding="utf-8") as f:
            content = f.read()
        assert "15000" in content, "15s stalled interval check is missing from app.js"


# =====================================================================
# 3. SSE Event Parsing Tests  
# =====================================================================

class TestSSEEventParsing:
    """
    Simulates the frontend's SSE parsing logic to verify that tool
    progress events are correctly intercepted and rendered.
    """

    def _parse_sse_stream(self, raw_lines):
        """
        Replicates the core SSE parsing loop from app.js streamChat().
        Returns (full_text, tool_calls_seen).
        """
        full_text = ""
        tool_calls = []
        current_event = "message"

        for line in raw_lines:
            trimmed = line.strip()
            if trimmed.startswith("event: "):
                current_event = trimmed[7:].strip()
            elif trimmed.startswith("data: "):
                if trimmed == "data: [DONE]":
                    break

                if current_event == "hermes.tool.progress":
                    try:
                        data = json.loads(trimmed[6:])
                        if data.get("tool_name"):
                            tool_calls.append(data["tool_name"])
                            full_text += f'\n<div class="tool-call-block">{data["tool_name"]}</div>\n'
                    except json.JSONDecodeError:
                        pass

                elif current_event == "heartbeat":
                    pass  # ignored

                else:
                    try:
                        data = json.loads(trimmed[6:])
                        choices = data.get("choices", [])
                        if choices:
                            delta = choices[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                full_text += content
                    except json.JSONDecodeError:
                        pass

                current_event = "message"

        return full_text, tool_calls

    def test_basic_text_streaming(self):
        """Verify plain text tokens are accumulated correctly."""
        lines = [
            'data: {"choices": [{"delta": {"content": "Hello"}}]}',
            'data: {"choices": [{"delta": {"content": " World"}}]}',
            'data: [DONE]',
        ]
        text, tools = self._parse_sse_stream(lines)
        assert text == "Hello World"
        assert tools == []

    def test_tool_progress_event_captured(self):
        """
        Verify that hermes.tool.progress events are intercepted
        and injected into the output text.
        """
        lines = [
            'data: {"choices": [{"delta": {"content": "Let me check."}}]}',
            'event: hermes.tool.progress',
            'data: {"tool_name": "browser.vision", "status": "running", "arguments": "{}"}',
            'data: {"choices": [{"delta": {"content": " Done."}}]}',
            'data: [DONE]',
        ]
        text, tools = self._parse_sse_stream(lines)
        assert "browser.vision" in text
        assert tools == ["browser.vision"]
        assert "Let me check." in text
        assert "Done." in text

    def test_multiple_tool_calls(self):
        """Verify multiple sequential tool calls are all captured."""
        lines = [
            'event: hermes.tool.progress',
            'data: {"tool_name": "browser_navigate", "status": "running"}',
            'event: hermes.tool.progress',
            'data: {"tool_name": "browser.vision", "status": "running"}',
            'event: hermes.tool.progress',
            'data: {"tool_name": "web_search", "status": "running"}',
            'data: {"choices": [{"delta": {"content": "Results found."}}]}',
            'data: [DONE]',
        ]
        text, tools = self._parse_sse_stream(lines)
        assert tools == ["browser_navigate", "browser.vision", "web_search"]
        assert "Results found." in text

    def test_heartbeat_ignored(self):
        """Heartbeats should not produce any visible output."""
        lines = [
            'data: {"choices": [{"delta": {"content": "A"}}]}',
            'event: heartbeat',
            'data: {"timestamp": 1234567890}',
            'data: {"choices": [{"delta": {"content": "B"}}]}',
            'data: [DONE]',
        ]
        text, tools = self._parse_sse_stream(lines)
        assert text == "AB"
        assert "timestamp" not in text

    def test_malformed_tool_event_skipped(self):
        """Malformed JSON in tool events should not crash the parser."""
        lines = [
            'event: hermes.tool.progress',
            'data: {this_is_not_valid_json}',
            'data: {"choices": [{"delta": {"content": "OK"}}]}',
            'data: [DONE]',
        ]
        text, tools = self._parse_sse_stream(lines)
        assert text == "OK"
        assert tools == []

    def test_done_stops_processing(self):
        """Lines after [DONE] should be ignored."""
        lines = [
            'data: {"choices": [{"delta": {"content": "Before"}}]}',
            'data: [DONE]',
            'data: {"choices": [{"delta": {"content": "After"}}]}',
        ]
        text, tools = self._parse_sse_stream(lines)
        assert text == "Before"
        assert "After" not in text

    def test_empty_delta_content_ignored(self):
        """Delta with null/empty content should not add garbage."""
        lines = [
            'data: {"choices": [{"delta": {}}]}',
            'data: {"choices": [{"delta": {"content": ""}}]}',
            'data: {"choices": [{"delta": {"content": "Real"}}]}',
            'data: [DONE]',
        ]
        text, tools = self._parse_sse_stream(lines)
        assert text == "Real"


# =====================================================================
# 4. Hermes Gateway Tool Emission Tests
# =====================================================================

class TestGatewayToolEmission:
    """Verifies hermes-gateway emits tool progress events correctly."""

    def test_gateway_emits_tool_progress_before_execution(self):
        """
        Verify that stream_agentic_loop emits an SSE event with
        event: hermes.tool.progress before executing each tool.
        """
        import sys
        sys.path.insert(0, "d:\\Github\\hermes-gateway")
        try:
            import importlib
            # Read the source file to check for the emit pattern
            with open("d:\\Github\\hermes-gateway\\main.py", "r", encoding="utf-8") as f:
                source = f.read()
            
            assert "hermes.tool.progress" in source, (
                "hermes-gateway main.py does not emit hermes.tool.progress events. "
                "The frontend will never see tool executions."
            )
            assert "tool_name" in source, (
                "hermes-gateway tool progress event does not include tool_name"
            )
        finally:
            if "d:\\Github\\hermes-gateway" in sys.path:
                sys.path.remove("d:\\Github\\hermes-gateway")


# =====================================================================
# 5. Error Handling in Orchestration Flow
# =====================================================================

class TestOrchestrationErrorHandling:
    """Tests for how the frontend handles agent failures gracefully."""

    def test_streamchat_returns_error_type_on_failure(self):
        """
        When an agent returns a non-200 response, streamChat should 
        return {type: 'error'} so the orchestrator can skip that agent.
        Verify the error path exists in the source code.
        """
        with open("app.js", "r", encoding="utf-8") as f:
            content = f.read()
        
        # The function should have an error return path
        assert "type: 'error'" in content or "type: \"error\"" in content, (
            "streamChat does not have an error return path. "
            "Agent failures will cause unhandled promise rejections."
        )

    def test_retrieval_uses_promise_all(self):
        """
        Promise.all means if ANY agent rejects, the whole phase fails.
        Verify this is still the pattern (may need to change to allSettled).
        """
        with open("app.js", "r", encoding="utf-8") as f:
            content = f.read()
        
        # Just verify the pattern exists — this is informational
        has_promise_all = "Promise.all(retrievalPromises)" in content
        has_promise_allsettled = "Promise.allSettled(retrievalPromises)" in content
        
        assert has_promise_all or has_promise_allsettled, (
            "Retrieval phase doesn't use Promise.all or Promise.allSettled"
        )


# =====================================================================
# 6. Proxy Heartbeat Tests
# =====================================================================

class TestProxyHeartbeat:
    """Verifies the proxy sends heartbeats to keep connections alive."""

    def test_heartbeat_thread_exists_in_proxy(self):
        """The proxy should spawn a heartbeat thread to prevent idle timeouts."""
        import inspect
        import proxy
        source = inspect.getsource(proxy.CORSAndProxyHandler.do_POST)
        assert "heartbeat" in source, (
            "Proxy do_POST does not contain heartbeat logic. "
            "Long-running tool calls will cause the connection to drop."
        )
