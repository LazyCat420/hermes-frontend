import pytest
from unittest.mock import MagicMock, patch
import json
import proxy
import urllib.request
import io
import respx
import httpx

@patch("proxy.psycopg2.connect")
def test_fetch_db_success(mock_connect):
    """Verifies that fetch_db correctly transforms database rows into JSON-serializable dictionaries."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    
    mock_connect.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor
    
    mock_cursor.fetchall.return_value = [
        {"id": 1, "score": 0.95, "is_elite": True},
        {"id": 2, "score": 0.45, "is_elite": False}
    ]
    
    result = proxy.fetch_db("SELECT * FROM dummy")
    
    assert result["status"] == "ok"
    assert len(result["data"]) == 2
    assert result["data"][0]["is_elite"] is True

@patch("proxy.psycopg2.connect")
def test_fetch_db_missing_table(mock_connect):
    """Verifies that fetch_db gracefully handles missing tables without crashing the proxy."""
    import psycopg2.errors
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_connect.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor
    
    mock_cursor.execute.side_effect = psycopg2.errors.UndefinedTable("relation does not exist")
    result = proxy.fetch_db("SELECT * FROM missing_table")
    assert result["status"] == "table_missing"

# Proxy Audit Tests

@patch("proxy.psycopg2.connect")
def test_proxy_audit_logging(mock_connect):
    """Verifies that the proxy intercepts stream chunks and writes them to llm_audit_logs."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_connect.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor

    # Simulate an HTTP request to the proxy
    handler = proxy.CORSAndProxyHandler.__new__(proxy.CORSAndProxyHandler)
    handler.path = "/api/dgx2/v1/chat/completions"
    handler.headers = {"Content-Length": "33"}
    handler.rfile = io.BytesIO(b'{"model": "test", "messages": []}')
    handler.wfile = io.BytesIO()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    # We mock urllib.request.urlopen to return a mock response that simulates an SSE stream
    mock_response = MagicMock()
    mock_response.status = 200
    mock_response.readline.side_effect = [
        b'data: {"choices": [{"delta": {"content": "Hello"}}]}\n',
        b'data: {"choices": [{"delta": {"content": " World"}}]}\n',
        b'data: [DONE]\n',
        b''
    ]
    mock_response.__enter__.return_value = mock_response

    with patch("urllib.request.urlopen", return_value=mock_response):
        handler.do_POST()

    # Verify that the DB was called to insert the audit log
    assert mock_cursor.execute.called
    insert_call_args = mock_cursor.execute.call_args[0]
    query = insert_call_args[0]
    params = insert_call_args[1]
    
    assert "INSERT INTO llm_audit_logs" in query
    assert params[0] == "dgx2"  # agent_name parsed from URL
    assert "test" in params[1]  # prompt context
    assert params[2] == "Hello World"  # accumulated content
    assert type(params[3]) == int  # execution_time_ms
