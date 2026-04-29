import pytest
from unittest.mock import MagicMock, patch
import proxy

@patch("proxy.psycopg2.connect")
def test_fetch_db_success(mock_connect):
    """Verifies that fetch_db correctly transforms database rows into JSON-serializable dictionaries."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    
    mock_connect.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor
    
    # Mock some data coming from postgres
    mock_cursor.fetchall.return_value = [
        {"id": 1, "score": 0.95, "is_elite": True},
        {"id": 2, "score": 0.45, "is_elite": False}
    ]
    
    result = proxy.fetch_db("SELECT * FROM dummy")
    
    assert result["status"] == "ok"
    assert len(result["data"]) == 2
    assert result["data"][0]["is_elite"] is True
    assert result["data"][1]["score"] == 0.45

@patch("proxy.psycopg2.connect")
def test_fetch_db_missing_table(mock_connect):
    """Verifies that fetch_db gracefully handles missing tables without crashing the proxy."""
    import psycopg2.errors
    
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    
    mock_connect.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor
    
    # Simulate a missing table
    mock_cursor.execute.side_effect = psycopg2.errors.UndefinedTable("relation does not exist")
    
    result = proxy.fetch_db("SELECT * FROM missing_table")
    
    assert result["status"] == "table_missing"
    assert result["data"] == []
