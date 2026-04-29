import psycopg2
from psycopg2.extras import RealDictCursor
import random

DB_URL = "postgresql://admin:password@10.0.0.16:5431/hermes_general_bots"

def get_db_connection():
    return psycopg2.connect(DB_URL)

def get_elites():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("SELECT * FROM evolution_grid WHERE is_elite = true;")
    elites = cursor.fetchall()
    conn.close()
    return elites

def mutate_agent(x, y):
    """Selects an elite agent, mutates it slightly, and places it at (x, y)."""
    elites = get_elites()
    if not elites:
        return {"error": "No elites available to mutate."}
        
    parent = random.choice(elites)
    
    # Mutate parameters slightly (CMA-ES style exploration)
    new_temp = min(max(parent['temperature'] + random.uniform(-0.2, 0.2), 0.0), 1.0)
    new_top_p = min(max(parent['top_p'] + random.uniform(-0.1, 0.1), 0.0), 1.0)
    
    # Context window mutation
    contexts = ["8k", "16k", "32k", "64k", "128k"]
    curr_idx = contexts.index(parent['memory_context']) if parent['memory_context'] in contexts else 2
    new_idx = min(max(curr_idx + random.choice([-1, 0, 1]), 0), len(contexts)-1)
    new_context = contexts[new_idx]
    
    new_label = parent['label'].split(' v')[0] + f" Mut-v{random.randint(100, 999)}"
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO evolution_grid (x, y, label, is_elite, score, memory_context, temperature, top_p, tools_profile, system_prompt)
        VALUES (%s, %s, %s, false, 0.0, %s, %s, %s, %s, %s)
        ON CONFLICT (x, y) DO UPDATE SET
            label = EXCLUDED.label,
            is_elite = EXCLUDED.is_elite,
            score = EXCLUDED.score,
            memory_context = EXCLUDED.memory_context,
            temperature = EXCLUDED.temperature,
            top_p = EXCLUDED.top_p,
            tools_profile = EXCLUDED.tools_profile,
            system_prompt = EXCLUDED.system_prompt,
            updated_at = CURRENT_TIMESTAMP
        RETURNING id;
    """, (x, y, new_label, new_context, round(new_temp, 2), round(new_top_p, 2), parent['tools_profile'], parent['system_prompt']))
    
    new_id = cursor.fetchone()[0]
    conn.commit()
    conn.close()
    
    return {"status": "success", "parent_id": parent['id'], "new_id": new_id, "label": new_label, "x": x, "y": y}

def submit_eval(x, y, success_rate, tokens, latency, collaboration_rounds=1, conflict_resolution=False, eval_type="task_completion"):
    """Submits an eval and updates the score. If score > 0.8, becomes elite."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Find the agent at x,y
    cursor.execute("SELECT id FROM evolution_grid WHERE x = %s AND y = %s", (x, y))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return {"error": f"No agent at {x},{y}"}
    grid_id = row[0]
    
    # Log the eval
    cursor.execute("""
        INSERT INTO deep_evals (generation_id, eval_type, success_rate, tokens_used, latency_ms, collaboration_rounds, conflict_resolution)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, (grid_id, eval_type, success_rate, tokens, latency, collaboration_rounds, conflict_resolution))
    
    # Get all evals for this generation to update moving average score
    cursor.execute("SELECT AVG(success_rate) FROM deep_evals WHERE generation_id = %s", (grid_id,))
    avg_score = cursor.fetchone()[0]
    
    is_elite = avg_score >= 0.8
    
    cursor.execute("""
        UPDATE evolution_grid 
        SET score = %s, is_elite = %s, updated_at = CURRENT_TIMESTAMP
        WHERE id = %s
    """, (avg_score, is_elite, grid_id))
    
    conn.commit()
    conn.close()
    
    return {"status": "success", "new_score": avg_score, "is_elite": is_elite}
