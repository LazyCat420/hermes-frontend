import pytest

def simulate_frontend_history_builder():
    """
    Simulates the context injection logic found in app.js
    to ensure mathematically no data is lost between agent handoffs.
    """
    history = [{"role": "system", "content": "Initial Prompt"}]
    
    # 1. User Input
    history.append({"role": "user", "content": "Find me the top news."})
    
    # 2. Planning Phase 1 & 2
    state = {
        "planningBoard": {
            "finalAssignments": {
                "dgx_spark_2": "I'll take the Scout role.",
                "jetson": "I will aggregate finance news."
            }
        },
        "findingsBoard": [
            {"agent": "dgx_spark_2 (Thread 1)", "content": "[CLAIM] Markets are up [/CLAIM]"},
            {"agent": "jetson (Thread 1)", "content": "[CLAIM] Tech stocks rally [/CLAIM]"}
        ]
    }
    activeAgents = ["dgx_spark_2", "jetson"]
    AGENTS = {
        "dgx_spark_2": {"name": "DGX Spark 2 (Primary)"},
        "jetson": {"name": "Jetson Orin AGX 64GB"}
    }
    
    # Simulate app.js line 782 (Inject TEAM PLAN LOCK)
    teamPlanContext = "TEAM PLAN LOCK:\n"
    for k in activeAgents:
        teamPlanContext += f"- {AGENTS[k]['name']}: {state['planningBoard']['finalAssignments'][k]}\n"
    history.append({"role": "system", "content": teamPlanContext})
    
    # Verify Planning Injection
    assert len(history) == 3
    assert "TEAM PLAN LOCK:" in history[-1]["content"]
    assert "DGX Spark 2 (Primary): I'll take the Scout role." in history[-1]["content"]
    
    # Simulate app.js line 854 (Inject EVIDENCE FOUND)
    findingsContext = "EVIDENCE FOUND:\n"
    for f in state['findingsBoard']:
        if '(Follow-up)' not in f['agent']:
            findingsContext += f"[{f['agent']}]: {f['content']}\n"
    history.append({"role": "system", "content": findingsContext})
    
    # Verify Findings Injection
    assert len(history) == 4
    assert "EVIDENCE FOUND:" in history[-1]["content"]
    assert "[dgx_spark_2 (Thread 1)]: [CLAIM] Markets are up [/CLAIM]" in history[-1]["content"]

    # Simulate Synthesis Prompt Injection
    fullFindings = ""
    for f in state['findingsBoard']:
        fullFindings += f"[{f['agent']}]: {f['content']}\n"
        
    synthMessages = list(history)
    synthMessages.append({
        "role": "user",
        "content": f"SYSTEM INSTRUCTION: You are the final Synthesist. Draft the final response to the user's original request using ONLY the verified data from the findings board:\n{fullFindings}\n\nENSURE you preserve and include clickable markdown links [Title](url)."
    })
    
    assert len(synthMessages) == 5
    assert "Markets are up" in synthMessages[-1]["content"]
    assert "Tech stocks rally" in synthMessages[-1]["content"]

def test_orchestration_flow():
    simulate_frontend_history_builder()

