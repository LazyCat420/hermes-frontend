import asyncio
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import json

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

async def mock_stream():
    # Send a regular token
    yield "data: {\"choices\": [{\"delta\": {\"content\": \"Let me \"}}]}\n\n"
    await asyncio.sleep(0.5)
    yield "data: {\"choices\": [{\"delta\": {\"content\": \"check \"}}]}\n\n"
    await asyncio.sleep(0.5)
    
    # Send tool progress event
    progress_data = {"tool_name": "browser.vision", "status": "running", "arguments": "{}"}
    yield f"event: hermes.tool.progress\ndata: {json.dumps(progress_data)}\n\n"
    await asyncio.sleep(1)
    
    # Send more content
    yield "data: {\"choices\": [{\"delta\": {\"content\": \"the web for you.\"}}]}\n\n"
    await asyncio.sleep(0.5)
    yield "data: [DONE]\n\n"

@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    return StreamingResponse(
        mock_stream(),
        media_type="text/event-stream"
    )

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8642)
