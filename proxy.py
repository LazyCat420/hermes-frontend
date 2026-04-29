import http.server
import socketserver
import urllib.request
import json
import psycopg2
from psycopg2.extras import RealDictCursor
import structlog
from tenacity import retry, stop_after_attempt, wait_fixed
import time

log = structlog.get_logger()

import os
DB_URL = os.getenv("DB_URL", "postgresql://localhost:5432/hermes_general_bots")

def fetch_db(query):
    try:
        conn = psycopg2.connect(DB_URL)
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(query)
        res = cursor.fetchall()
        
        # Convert memoryview/datetime to string for JSON serialization
        formatted_res = []
        for row in res:
            formatted_row = {}
            for k, v in row.items():
                if hasattr(v, 'isoformat'):
                    formatted_row[k] = v.isoformat()
                else:
                    formatted_row[k] = v
            formatted_res.append(formatted_row)
            
        conn.close()
        return {"status": "ok", "data": formatted_res}
    except psycopg2.errors.UndefinedTable:
        return {"status": "table_missing", "data": []}
    except Exception as e:
        return {"status": "error", "error": str(e)}

PORT = 3005

# Map of local paths to target Hermes endpoints
TARGETS = {
    "/api/dgx2/v1/chat/completions": "http://10.0.0.103:8642/v1/chat/completions",
    "/api/dgx1/v1/chat/completions": "http://10.0.0.141:8642/v1/chat/completions",
    "/api/jetson/v1/chat/completions": "http://10.0.0.30:8642/v1/chat/completions",
}

class CORSAndProxyHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/dashboard/evals":
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            data = fetch_db("SELECT * FROM deep_evals ORDER BY timestamp DESC LIMIT 10;")
            self.wfile.write(json.dumps(data).encode())
            return
        elif self.path == "/api/dashboard/research":
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            data = fetch_db("SELECT * FROM auto_research_logs ORDER BY timestamp DESC LIMIT 10;")
            self.wfile.write(json.dumps(data).encode())
            return
        elif self.path == "/api/dashboard/evolution":
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            data = fetch_db("SELECT * FROM evolution_grid ORDER BY updated_at DESC LIMIT 10;")
            self.wfile.write(json.dumps(data).encode())
            return
            
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/evolution/mutate":
            content_length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_length))
            x = body.get('x', 0)
            y = body.get('y', 0)
            
            try:
                import evolution_engine
                res = evolution_engine.mutate_agent(x, y)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(res).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            return
            
        if self.path == "/api/evals/submit":
            content_length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_length))
            
            try:
                import evolution_engine
                res = evolution_engine.submit_eval(
                    body.get('x', 0),
                    body.get('y', 0),
                    body.get('success_rate', 0.0),
                    body.get('tokens', 0),
                    body.get('latency', 0),
                    body.get('collaboration_rounds', 1),
                    body.get('conflict_resolution', False)
                )
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(res).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            return

        if self.path == "/api/research/log":
            content_length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_length))
            question = body.get('question', '')
            source = body.get('source', 'auto')
            
            try:
                conn = psycopg2.connect(DB_URL)
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO auto_research_logs (task_description, outcome, turns_taken)
                    VALUES (%s, %s, %s)
                """, (question, source, 1))
                conn.commit()
                conn.close()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success"}).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            return


        target_url = None
        for path, url in TARGETS.items():
            if self.path == path:
                target_url = url
                break

        if target_url:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            req = urllib.request.Request(target_url, data=body, method='POST')
            req.add_header('Content-Type', 'application/json')
            req.add_header('Authorization', self.headers.get('Authorization', 'Bearer change-me-local-dev'))

            start_time = time.time()
            prompt_data = json.loads(body) if body else {}
            
            log.info("llm_request_started", target=target_url, model=prompt_data.get('model'))

            @retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
            def get_response():
                return urllib.request.urlopen(req, timeout=300)

            try:
                with get_response() as response:
                    self.send_response(response.status)
                    self.send_header('Content-Type', 'text/event-stream')
                    self.send_header('Cache-Control', 'no-cache')
                    self.end_headers()
                    
                    import threading
                    is_done = [False]
                    
                    def heartbeat_loop():
                        while not is_done[0]:
                            time.sleep(5)
                            if not is_done[0]:
                                try:
                                    self.wfile.write(b": heartbeat\n\n")
                                    self.wfile.flush()
                                except:
                                    break

                    t = threading.Thread(target=heartbeat_loop, daemon=True)
                    t.start()
                    
                    accumulated_content = ""
                    try:
                        while True:
                            line = response.readline()
                            if not line:
                                break
                            self.wfile.write(line)
                            self.wfile.flush()
                            
                            decoded = line.decode('utf-8', errors='ignore').strip()
                            if decoded.startswith("data: ") and decoded != "data: [DONE]":
                                try:
                                    chunk = json.loads(decoded[6:])
                                    if "choices" in chunk and len(chunk["choices"]) > 0:
                                        delta = chunk["choices"][0].get("delta", {})
                                        if "content" in delta:
                                            accumulated_content += delta["content"]
                                except Exception:
                                    pass
                                    
                            if decoded == "data: [DONE]":
                                break
                    finally:
                        is_done[0] = True
                        
                        # Log to database
                        exec_time = int((time.time() - start_time) * 1000)
                        log.info("llm_request_completed", target=target_url, exec_time_ms=exec_time)
                        
                        try:
                            agent_name = "unknown"
                            for key, val in TARGETS.items():
                                if val == target_url:
                                    agent_name = key.split('/')[2]
                                    break
                            
                            conn = psycopg2.connect(DB_URL)
                            cursor = conn.cursor()
                            cursor.execute("""
                                INSERT INTO llm_audit_logs 
                                (agent_name, prompt_context, raw_response, execution_time_ms)
                                VALUES (%s, %s, %s, %s)
                            """, (agent_name, json.dumps(prompt_data), accumulated_content, exec_time))
                            conn.commit()
                            conn.close()
                        except Exception as db_e:
                            log.error("audit_log_failed", error=str(db_e))
                            
            except (ConnectionAbortedError, BrokenPipeError):
                log.warning("client_disconnected", target=target_url)
            except Exception as e:
                log.error("llm_request_failed", error=str(e), target=target_url)
                try:
                    self.send_response(500)
                    self.end_headers()
                    self.wfile.write(str(e).encode())
                except:
                    pass
        else:
            self.send_response(404)
            self.end_headers()

class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == "__main__":
    try:
        with ThreadingTCPServer(("", PORT), CORSAndProxyHandler) as httpd:
            print(f"Serving UI at http://localhost:{PORT}")
            print("Proxying API requests to bypass CORS:")
            for path, target in TARGETS.items():
                print(f"  {path} -> {target}")
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
