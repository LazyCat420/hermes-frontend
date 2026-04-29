import psycopg2
import sys
from datetime import datetime

import os
DB_URL = os.getenv("DB_URL", "postgresql://localhost:5432/hermes_general_bots")

def init_db():
    try:
        print(f"Connecting to database at {DB_URL}...")
        conn = psycopg2.connect(DB_URL)
        cursor = conn.cursor()

        print("Creating evolution_grid table...")
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS evolution_grid (
            id SERIAL PRIMARY KEY,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            label VARCHAR(255) NOT NULL,
            is_elite BOOLEAN DEFAULT false,
            score FLOAT DEFAULT 0.0,
            memory_context VARCHAR(50) NOT NULL,
            temperature FLOAT NOT NULL,
            top_p FLOAT NOT NULL,
            tools_profile VARCHAR(50) NOT NULL,
            system_prompt TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(x, y)
        );
        """)

        print("Creating deep_evals table...")
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS deep_evals (
            id SERIAL PRIMARY KEY,
            generation_id INTEGER REFERENCES evolution_grid(id),
            eval_type VARCHAR(100),
            success_rate FLOAT,
            tokens_used INTEGER,
            latency_ms INTEGER,
            collaboration_rounds INTEGER DEFAULT 1,
            conflict_resolution BOOLEAN DEFAULT false,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)
        
        # Ensure new columns exist for existing databases
        cursor.execute("""
        DO $$
        BEGIN
            BEGIN
                ALTER TABLE deep_evals ADD COLUMN collaboration_rounds INTEGER DEFAULT 1;
            EXCEPTION
                WHEN duplicate_column THEN NULL;
            END;
            BEGIN
                ALTER TABLE deep_evals ADD COLUMN conflict_resolution BOOLEAN DEFAULT false;
            EXCEPTION
                WHEN duplicate_column THEN NULL;
            END;
        END $$;
        """)

        print("Creating auto_research_logs table...")
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS auto_research_logs (
            id SERIAL PRIMARY KEY,
            agent_id INTEGER REFERENCES evolution_grid(id),
            task_description TEXT,
            outcome VARCHAR(50),
            turns_taken INTEGER,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        print("Creating llm_audit_logs table...")
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS llm_audit_logs (
            id SERIAL PRIMARY KEY,
            agent_name VARCHAR(100),
            prompt_context TEXT,
            raw_response TEXT,
            parsed_json JSONB,
            execution_time_ms INTEGER,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)


        # Seeding baseline archetypes
        print("Seeding baseline MAP-Elites archetypes...")
        
        # Suffix added to all archetypes to ensure source citations
        citation_rule = " ALWAYS cite your sources using clickable markdown links, e.g., [Title](url), so the user can verify the data."
        
        archetypes = [
            (0, 0, "Static Recall", False, 0.42, "8k", 0.1, 0.9, "strict", "You are a precise recall agent. Rely strictly on retrieved context. Do not invent details." + citation_rule),
            (4, 4, "Chaotic Oracle", True, 0.91, "128k", 0.9, 0.95, "exploratory", "You are a chaotic oracle. Synthesize wildly disparate ideas. Use all tools at your disposal to explore the unknown." + citation_rule),
            (2, 2, "Balanced Guide", True, 0.85, "32k", 0.5, 0.9, "adaptive", "You are a balanced guide. Weigh context carefully against prior knowledge. Be helpful and clear." + citation_rule),
            (0, 4, "Rapid Innovator", False, 0.65, "8k", 0.8, 0.9, "exploratory", "You are a rapid innovator. Iterate quickly, use tools efficiently, and try unconventional approaches within small context limits." + citation_rule),
            (4, 0, "Deep Archivist", True, 0.88, "128k", 0.2, 0.9, "strict", "You are a deep archivist. Scour massive contexts with absolute precision. Never hallucinate." + citation_rule),
            (1, 1, "Cautious Assistant", False, 0.55, "16k", 0.3, 0.9, "strict", "You are a cautious assistant. Only act when certain. Do not overstep your instructions." + citation_rule),
            (3, 3, "Creative Partner", True, 0.82, "64k", 0.7, 0.9, "adaptive", "You are a creative partner. Suggest alternative perspectives and use tools to enrich the user's workflow." + citation_rule)
        ]

        for arch in archetypes:
            cursor.execute("""
            INSERT INTO evolution_grid (x, y, label, is_elite, score, memory_context, temperature, top_p, tools_profile, system_prompt)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (x, y) DO UPDATE SET
                label = EXCLUDED.label,
                is_elite = EXCLUDED.is_elite,
                score = EXCLUDED.score,
                memory_context = EXCLUDED.memory_context,
                temperature = EXCLUDED.temperature,
                top_p = EXCLUDED.top_p,
                tools_profile = EXCLUDED.tools_profile,
                system_prompt = EXCLUDED.system_prompt,
                updated_at = CURRENT_TIMESTAMP;
            """, arch)

        conn.commit()
        print("Database initialization and seeding complete.")
        cursor.close()
        conn.close()

    except Exception as e:
        print(f"Error initializing database: {e}")
        sys.exit(1)

if __name__ == "__main__":
    init_db()
