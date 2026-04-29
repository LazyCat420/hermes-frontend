import pytest
from unittest.mock import MagicMock, patch
import evolution_engine
from hypothesis import given, strategies as st

@patch("evolution_engine.psycopg2.connect")
def test_submit_eval_success(mock_connect):
    """Verifies that an eval with collaboration metrics correctly computes moving averages and updates grid."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    
    mock_connect.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor
    
    # Mock finding the agent at x,y
    mock_cursor.fetchone.side_effect = [
        (101,),       # grid_id
        (0.85,)       # avg_score
    ]
    
    result = evolution_engine.submit_eval(
        x=2, y=3,
        success_rate=0.9,
        tokens=1500,
        latency=1200,
        collaboration_rounds=3,
        conflict_resolution=True,
        eval_type="swarm_task"
    )
    
    assert result["status"] == "success"
    assert result["new_score"] == 0.85
    assert result["is_elite"] is True
    
    # Verify the correct SQL inserts were called
    assert mock_cursor.execute.call_count == 4
    
    # Check the INSERT statement for deep_evals
    insert_call = mock_cursor.execute.call_args_list[1]
    sql_str, sql_args = insert_call[0]
    assert "INSERT INTO deep_evals" in sql_str
    # Expected args: (grid_id, eval_type, success_rate, tokens, latency, collaboration_rounds, conflict_resolution)
    assert sql_args == (101, "swarm_task", 0.9, 1500, 1200, 3, True)

@patch("evolution_engine.psycopg2.connect")
def test_submit_eval_no_agent(mock_connect):
    """Verifies failure behavior when no agent is found at the given x,y coordinates."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    
    mock_connect.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor
    
    # Mock no agent found
    mock_cursor.fetchone.return_value = None
    
    result = evolution_engine.submit_eval(
        x=99, y=99,
        success_rate=0.5,
        tokens=100,
        latency=100,
    )
    
    assert "error" in result
    assert result["error"] == "No agent at 99,99"
    # Should not log the eval
    assert mock_cursor.execute.call_count == 1

@patch("evolution_engine.psycopg2.connect")
@given(
    success_rate=st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    tokens=st.integers(min_value=0, max_value=1_000_000),
    latency=st.floats(min_value=0.0, max_value=60000.0, allow_nan=False, allow_infinity=False),
    collab_rounds=st.integers(min_value=1, max_value=100)
)
def test_submit_eval_fuzzing(mock_connect, success_rate, tokens, latency, collab_rounds):
    """Uses Hypothesis to verify submit_eval logic handles boundary data robustly."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    
    mock_connect.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor
    
    # Mock finding the agent at x,y
    mock_cursor.fetchone.side_effect = [
        (101,),       # grid_id
        (success_rate,)  # Tuple for db row
    ]
    
    result = evolution_engine.submit_eval(
        x=0, y=0,
        success_rate=success_rate,
        tokens=tokens,
        latency=latency,
        collaboration_rounds=collab_rounds,
        conflict_resolution=False,
        eval_type="fuzz_test"
    )
    
    assert result["status"] == "success"
    # Ensure float rounding doesn't crash
    assert isinstance(result["new_score"], float)
    assert result["is_elite"] == (success_rate >= 0.8)
