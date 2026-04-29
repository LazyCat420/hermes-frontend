import schedule
import time
import random
import psycopg2
from evolution_engine import mutate_agent, get_elites, DB_URL

def log_research(message):
    try:
        conn = psycopg2.connect(DB_URL)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO auto_research_logs (task_description, outcome, turns_taken)
            VALUES (%s, %s, %s)
        """, (message, 'auto_mutated', 0))
        conn.commit()
        conn.close()
        print(message)
    except Exception as e:
        print(f"Failed to log research: {e}")

def evolution_tick():
    print("Running evolution tick...")
    try:
        elites = get_elites()
        if len(elites) >= 2:
            x, y = random.randint(0, 4), random.randint(0, 4)
            result = mutate_agent(x, y)
            
            if 'error' in result:
                print(f"Mutation error: {result['error']}")
            else:
                label = result.get('label', 'Unknown')
                log_research(f"Auto-mutated -> {label} at ({x},{y})")
        else:
            print(f"Not enough elites to trigger mutation ({len(elites)} found).")
    except Exception as e:
        print(f"Error during evolution tick: {e}")

if __name__ == "__main__":
    print("Starting background evolution daemon...")
    schedule.every(10).minutes.do(evolution_tick)
    
    # Run once immediately on startup
    evolution_tick()
    
    while True:
        schedule.run_pending()
        time.sleep(30)
