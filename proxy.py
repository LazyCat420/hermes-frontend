import http.server
import socketserver
import urllib.request
import json

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

    def do_POST(self):
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
            except (ConnectionAbortedError, BrokenPipeError):
                # The browser closed the connection while we were streaming to it. 
                # This is normal when the user refreshes the page. We silently abort.
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

with socketserver.TCPServer(("", PORT), CORSAndProxyHandler) as httpd:
    print(f"Serving UI at http://localhost:{PORT}")
    print("Proxying API requests to bypass CORS:")
    for path, target in TARGETS.items():
        print(f"  {path} -> {target}")
    httpd.serve_forever()
