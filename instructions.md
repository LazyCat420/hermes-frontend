I have 3 bots running on vllm docker endpoints. They all have hermes gateways running with them. I want to be able to make a frontend to be able to talk to all of them and have all 3 of them cordinate together to be able to help each other with whatever general task the user asks for.

# ── Hermes Agent (Hub-and-Spoke) ──

JETSON_HERMES_HOST="10.0.0.30"
JETSON_HERMES_PORT=8642

DGX_SPARK_HERMES_HOST="10.0.0.141"
DGX_SPARK_HERMES_PORT=8642

DGX_SPARK_2_HERMES_HOST="10.0.0.103"
DGX_SPARK_2_HERMES_PORT=8642

API_SERVER_KEY="change-me-local-dev"

# ── LLM Endpoints ──

JETSON_VLLM_URL="<http://10.0.0.30:8000>"

DGX_SPARK_VLLM_URL="<http://10.0.0.141:8000>"

DGX_SPARK_2_VLLM_URL="<http://10.0.0.103:8000>"

I just want to create a simple frontend using just html and javascript nothing fancy. I want it to have a chat interface where i can type a message and it will send it to all 3 agents. The agents will then coordinate together to come up with a response. They can use tool calls within the hermes gateways to call any other function they want. The responses will come back to the frontend and be displayed in the chat interface in the order they come back. The chat should always be able to talk to all 3 agents and have them coordinate with each other. It should also display what each agent is doing or thinking or planning to do. We need to make sure the system uses the least amount of resources possible and is very efficient to get the point across. It should always default to the largest and most powerful model unless the user specifies otherwise to be able to trigger the other 2 bots. They can all make their own subagents for what ever tasks they think are needed.
