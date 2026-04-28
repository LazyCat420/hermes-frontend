// Configuration for the 3 standalone Hermes endpoints
const AGENTS = {
    'dgx_spark_2': {
        id: 'dgx2',
        name: 'DGX Spark 2 (Primary)',
        url: '/api/dgx2/v1/chat/completions',
        model: 'Qwen/Qwen3.5-72B'
    },
    'dgx_spark_1': {
        id: 'dgx1',
        name: 'DGX Spark 1',
        url: '/api/dgx1/v1/chat/completions',
        model: 'Intel/Qwen3.5-122B'
    },
    'jetson': {
        id: 'jetson',
        name: 'Jetson Orin AGX 64GB',
        url: '/api/jetson/v1/chat/completions',
        model: 'Kbenkhalad/Qwen3.5-35B'
    }
};

const PRIMARY_AGENT = 'dgx_spark_2';

// Global Conversation State for the Agents
let globalHistory = [
    {
        role: "system",
        content: "You are the primary Hermes Coordinator. You can answer questions directly, but if you need specialized analysis, web searching, or data gathering, you should use your `delegate_to_agent` tool to ask 'jetson' or 'dgx_spark_1' for help. Always wait for their response before finalizing your answer."
    }
];

// Tools available to the agents
const TOOLS = [
    {
        type: "function",
        function: {
            name: "delegate_to_agent",
            description: "Ask another specialized Hermes agent to perform a task or answer a question.",
            parameters: {
                type: "object",
                properties: {
                    target_agent: {
                        type: "string",
                        enum: ["jetson", "dgx_spark_1"],
                        description: "The agent to delegate to. 'jetson' is great for fast data collection. 'dgx_spark_1' is massive and great for complex reasoning."
                    },
                    task: {
                        type: "string",
                        description: "The detailed prompt, question, or task you want the agent to execute."
                    }
                },
                required: ["target_agent", "task"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Search the web for real-time information, news, or facts.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The search query."
                    }
                },
                required: ["query"]
            }
        }
    }
];

// UI Elements
const chatHistory = document.getElementById('chatHistory');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

// Auto-resize textarea
messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight < 150 ? this.scrollHeight : 150) + 'px';
});

// Submit on Enter (Shift+Enter for new line)
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (messageInput.value.trim()) chatForm.dispatchEvent(new Event('submit'));
    }
});

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;

    // Reset input
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;

    // Append user message
    appendMessage('user', text);
    globalHistory.push({ role: 'user', content: text });

    // Start Orchestration loop for ALL agents in parallel
    // We pass a copy of the global history so they don't mutate each other's state while streaming
    Promise.all([
        orchestrate('dgx_spark_2', [...globalHistory]),
        orchestrate('dgx_spark_1', [...globalHistory]),
        orchestrate('jetson', [...globalHistory])
    ]).then(() => {
        // Once all 3 finish, we can allow the user to send the next message
        sendBtn.disabled = false;
        messageInput.focus();
    });
});

// Helper to update sidebar status
function setAgentStatus(agentKey, state, isThinking) {
    const card = document.getElementById(`agent-${AGENTS[agentKey].id}`);
    const stateText = document.getElementById(`state-${AGENTS[agentKey].id}`);
    if (card && stateText) {
        stateText.innerText = state;
        if (isThinking) {
            card.classList.add('thinking');
            card.classList.remove('active');
        } else if (state === 'Standing by') {
            card.classList.remove('thinking', 'active');
        } else {
            card.classList.add('active');
            card.classList.remove('thinking');
        }
    }
}

// Render message to UI
function appendMessage(role, content, senderName = '') {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'message-sender';
    nameDiv.innerText = senderName || (role === 'user' ? 'You' : 'Hermes');
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = marked.parse(content || '');

    div.appendChild(nameDiv);
    div.appendChild(contentDiv);
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    return contentDiv;
}

// Render Tool Call to UI
function appendToolCall(agentName, toolName, argsStr) {
    const div = document.createElement('div');
    div.className = 'tool-call-block';
    
    const header = document.createElement('div');
    header.className = 'tool-header';
    header.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 16 16 12 12 8"></polyline><line x1="8" y1="12" x2="16" y2="12"></line></svg>
        ${agentName} triggered <code>${toolName}</code>
    `;
    
    const content = document.createElement('div');
    content.className = 'tool-content';
    
    let displayArgs = argsStr;
    try {
        displayArgs = JSON.stringify(JSON.parse(argsStr), null, 2);
    } catch(e) {}
    
    content.innerText = displayArgs;

    div.appendChild(header);
    div.appendChild(content);
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    
    return content;
}

// Fetch from Hermes Gateway with SSE Parsing
async function streamChat(agentKey, messages, onChunk, onToolCall) {
    const url = AGENTS[agentKey].url;
    
    setAgentStatus(agentKey, "Processing...", true);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Make sure API_SERVER_KEY matches or remove if your Hermes doesn't check it
                'Authorization': 'Bearer change-me-local-dev' 
            },
            body: JSON.stringify({
                model: AGENTS[agentKey].model,
                messages: messages,
                tools: TOOLS,
                stream: true,
                temperature: 0.4,
                max_tokens: 4096
            })
        });

        if (!response.ok) {
            throw new Error(`Hermes Gateway Error: ${response.status} ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        
        let fullText = "";
        let activeToolCalls = {};
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            // SSE messages are separated by double newlines, but each line starts with "data: "
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep the last incomplete line in the buffer

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith("data: ") && trimmedLine !== "data: [DONE]") {
                    try {
                        const data = JSON.parse(trimmedLine.substring(6));
                        if (!data.choices || data.choices.length === 0) continue;
                        
                        const delta = data.choices[0].delta;
                        
                        // Handle Tool Calls
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const index = tc.index || 0;
                                if (!activeToolCalls[index]) {
                                    activeToolCalls[index] = { id: tc.id, name: tc.function.name, arguments: "" };
                                }
                                if (tc.function.arguments) {
                                    activeToolCalls[index].arguments += tc.function.arguments;
                                }
                            }
                        }
                        
                        // Handle Text
                        if (delta.content) {
                            fullText += delta.content;
                            onChunk(fullText);
                        }
                        
                    } catch (e) {
                        console.warn("Parse error on chunk:", trimmedLine);
                    }
                }
            }
        }
        
        setAgentStatus(agentKey, "Standing by", false);
        
        // If there were tool calls, return them
        const toolsFound = Object.values(activeToolCalls);
        if (toolsFound.length > 0) {
            if (onToolCall) onToolCall(toolsFound);
            return { type: 'tool_calls', calls: toolsFound };
        }
        
        return { type: 'text', content: fullText };

    } catch (error) {
        setAgentStatus(agentKey, "Error", false);
        console.error("Stream error:", error);
        return { type: 'error', error: error.message };
    }
}

// Orchestration Logic
async function orchestrate(agentKey, messages) {
    const agentName = AGENTS[agentKey].name;
    
    // Create UI block for streaming text
    const contentDiv = appendMessage('agent', '<div class="typing-indicator"><span></span><span></span><span></span></div>', agentName);
    
    const result = await streamChat(agentKey, messages, 
        // onChunk callback updates the UI in real time
        (text) => {
            contentDiv.innerHTML = marked.parse(text);
            chatHistory.scrollTop = chatHistory.scrollHeight;
        }
    );

    if (result.type === 'error') {
        contentDiv.innerHTML = `<span style="color: #ef4444;">Error: ${result.error}</span>`;
        return;
    }

    if (result.type === 'text') {
        // Conversation step complete
        messages.push({ role: 'assistant', content: result.content });
        // Make sure UI reflects final markdown
        contentDiv.innerHTML = marked.parse(result.content);
        return;
    }

    if (result.type === 'tool_calls') {
        // Agent wants to execute tools
        contentDiv.remove(); // Remove the empty typing indicator block if no text preceded the tool call
        
        // Push the assistant's tool call message to history
        const toolCallMsg = {
            role: 'assistant',
            content: null,
            tool_calls: result.calls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.arguments }
            }))
        };
        messages.push(toolCallMsg);

        // Execute each tool sequentially
        for (const tc of result.calls) {
            appendToolCall(agentName, tc.name, tc.arguments);
            
            let toolResponseText = "";
            
            if (tc.name === 'delegate_to_agent') {
                try {
                    const args = JSON.parse(tc.arguments);
                    const targetAgent = args.target_agent;
                    const subTask = args.task;
                    
                    if (!AGENTS[targetAgent]) throw new Error("Unknown target agent: " + targetAgent);
                    
                    // Create a sub-context for the delegated agent
                    const subContext = [
                        { role: 'system', content: `You are ${AGENTS[targetAgent].name}. Help the primary agent by fulfilling this request.` },
                        { role: 'user', content: subTask }
                    ];
                    
                    // Recursively call orchestrate, but we capture the final text instead of looping back to primary immediately
                    const subContentDiv = appendMessage('agent', '<div class="typing-indicator"><span></span><span></span><span></span></div>', `↳ ${AGENTS[targetAgent].name}`);
                    
                    const subResult = await streamChat(targetAgent, subContext, 
                        (text) => {
                            subContentDiv.innerHTML = marked.parse(text);
                            chatHistory.scrollTop = chatHistory.scrollHeight;
                        }
                    );
                    
                    if (subResult.type === 'text') {
                        subContentDiv.innerHTML = marked.parse(subResult.content);
                        toolResponseText = subResult.content;
                    } else {
                        toolResponseText = "Sub-agent failed or returned unexpected format.";
                        subContentDiv.innerHTML = `<span style="color: #ef4444;">${toolResponseText}</span>`;
                    }
                    
                } catch (e) {
                    toolResponseText = `Error delegating: ${e.message}`;
                    console.error(toolResponseText);
                }
            } else if (tc.name === 'web_search') {
                try {
                    const args = JSON.parse(tc.arguments);
                    const query = args.query;
                    
                    const searchRes = await fetch('/api/tools/search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: query })
                    });
                    
                    if (searchRes.ok) {
                        const data = await searchRes.json();
                        toolResponseText = data.result || "No results found.";
                    } else {
                        const data = await searchRes.json();
                        toolResponseText = `Search Error: ${data.error}`;
                    }
                } catch (e) {
                    toolResponseText = `Error performing web_search: ${e.message}`;
                    console.error(toolResponseText);
                }
            } else {
                toolResponseText = `Error: Tool ${tc.name} is not implemented in the frontend orchestrator.`;
            }

            // Push tool response to primary agent's history
            messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                name: tc.name,
                content: toolResponseText
            });
        }
        
        // Give the context back to the primary agent to synthesize the final answer
        await orchestrate(agentKey, messages);
    }
}
