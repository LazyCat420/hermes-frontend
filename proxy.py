import http.server
import socketserver
import urllib.request
import json
import psycopg2
from psycopg2.extras import RealDictCursor

DB_URL = "postgresql://admin:password@10.0.0.16:5431/hermes_general_bots"

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

PORT = 3000

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
                    body.get('latency', 0)
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

        if self.path == "/api/tools/search":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)
            query = data.get("query", "")
            
            try:
                from duckduckgo_search import DDGS
                with DDGS() as ddgs:
                    results = list(ddgs.text(query, max_results=5))
                
                formatted = ""
                for r in results:
                    formatted += f"Title: {r.get('title')}\nSnippet: {r.get('body')}\nURL: {r.get('href')}\n\n"
                    
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({"result": formatted}).encode())
                return
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

            try:
                with urllib.request.urlopen(req) as response:
                    self.send_response(response.status)
                    self.send_header('Content-Type', 'text/event-stream')
                    self.send_header('Cache-Control', 'no-cache')
                    self.end_headers()
                    
                    while True:
                        line = response.readline()
                        if not line:
                            break
                        self.wfile.write(line)
                        self.wfile.flush()
                        if line.strip() == b"data: [DONE]":
                            break
            except (ConnectionAbortedError, BrokenPipeError):
                pass
            except Exception as e:
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
    pass

with ThreadingTCPServer(("", PORT), CORSAndProxyHandler) as httpd:
    print(f"Serving UI at http://localhost:{PORT}")
    print("Proxying API requests to bypass CORS:")
    for path, target in TARGETS.items():
        print(f"  {path} -> {target}")
    httpd.serve_forever()
