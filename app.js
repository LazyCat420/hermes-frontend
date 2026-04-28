// Configuration for the 3 standalone Hermes endpoints
const AGENTS = {
    'dgx_spark_2': { id: 'dgx2', name: 'DGX Spark 2 (Primary)', url: '/api/dgx2/v1/chat/completions', model: 'Qwen/Qwen3.5-72B' },
    'dgx_spark_1': { id: 'dgx1', name: 'DGX Spark 1', url: '/api/dgx1/v1/chat/completions', model: 'Intel/Qwen3.5-122B' },
    'jetson': { id: 'jetson', name: 'Jetson Orin AGX 64GB', url: '/api/jetson/v1/chat/completions', model: 'Kbenkhalad/Qwen3.5-35B' }
};

// Global Conversation State for the Agents
let globalHistory = [
    {
        role: "system",
        content: "You are part of a 3-agent swarm (Jetson, DGX1, DGX2). Coordinate and execute tasks intelligently."
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

// Submit on Enter
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

    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;

    appendMessage('user', text);
    globalHistory.push({ role: 'user', content: text });

    // PHASE 1: The Huddle
    const huddleLoader = appendMessage('system', '<div class="typing-indicator" style="display:inline-block; margin-right: 10px;"><span></span><span></span><span></span></div> <i>Initiating Agent Huddle...</i>', 'System');
    
    // We send a planning prompt to all 3
    const huddlePromises = Object.keys(AGENTS).map(async (agentKey) => {
        const huddleMessages = [...globalHistory, {
            role: "user", 
            content: "SYSTEM HUDDLE: Before executing any tools, propose a brief 1-sentence strategy for how you will help answer the user's latest request. Do NOT execute tools yet. Just state your plan."
        }];
        const result = await streamChat(agentKey, huddleMessages, () => {}); // silent UI for huddle
        return { agent: AGENTS[agentKey].name, strategy: result.content };
    });

    const strategies = await Promise.all(huddlePromises);
    
    // Remove the huddle loading indicator
    huddleLoader.parentElement.remove();

    // Combine strategies
    let huddleSummary = "**STRATEGY HUDDLE COMPLETE:**\n\n";
    strategies.forEach(s => {
        huddleSummary += `- **${s.agent}**: ${s.strategy}\n`;
    });
    
    appendMessage('system', huddleSummary, 'Huddle Summary');
    globalHistory.push({ role: "system", content: huddleSummary + "\nNow, execute your part of the strategy using your native tools to fulfill the user's original request." });

    // PHASE 2: Coordinated Execution
    Promise.all([
        orchestrate('dgx_spark_2', [...globalHistory]),
        orchestrate('dgx_spark_1', [...globalHistory]),
        orchestrate('jetson', [...globalHistory])
    ]).then((results) => {
        // We append their final responses to globalHistory so the next turn remembers what they did
        globalHistory.push({ role: "assistant", content: `[DGX Spark 2]: ${results[0]}\n[DGX Spark 1]: ${results[1]}\n[Jetson]: ${results[2]}` });
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
function appendToolCall(agentName, toolName) {
    const div = document.createElement('div');
    div.className = 'tool-call-block';
    
    const header = document.createElement('div');
    header.className = 'tool-header';
    header.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 16 16 12 12 8"></polyline><line x1="8" y1="12" x2="16" y2="12"></line></svg>
        ${agentName} triggered native tool: <code>${toolName}</code>
    `;
    
    div.appendChild(header);
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Fetch from Hermes Gateway with SSE Parsing
async function streamChat(agentKey, messages, onChunk) {
    const url = AGENTS[agentKey].url;
    setAgentStatus(agentKey, "Processing...", true);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer change-me-local-dev' 
            },
            body: JSON.stringify({
                model: AGENTS[agentKey].model,
                messages: messages,
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
        let buffer = "";

        let isDone = false;
        while (!isDone) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); 

            let currentEvent = 'message';

            for (const line of lines) {
                const trimmedLine = line.trim();
                
                if (trimmedLine.startsWith("event: ")) {
                    currentEvent = trimmedLine.substring(7).trim();
                } else if (trimmedLine.startsWith("data: ")) {
                    if (trimmedLine === "data: [DONE]") {
                        isDone = true;
                        break;
                    }
                    if (currentEvent === 'hermes.tool.progress') {
                        try {
                            const data = JSON.parse(trimmedLine.substring(6));
                            if (data.tool_name) {
                                appendToolCall(AGENTS[agentKey].name, data.tool_name);
                            }
                        } catch(e) {}
                    } else {
                        try {
                            const data = JSON.parse(trimmedLine.substring(6));
                            if (!data.choices || data.choices.length === 0) continue;
                            const delta = data.choices[0].delta;
                            
                            if (delta.content) {
                                fullText += delta.content;
                                if (onChunk) onChunk(fullText);
                            }
                        } catch (e) {}
                    }
                    currentEvent = 'message';
                }
            }
        }
        
        setAgentStatus(agentKey, "Standing by", false);
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
    const contentDiv = appendMessage('agent', '<div class="typing-indicator"><span></span><span></span><span></span></div>', agentName);
    
    const result = await streamChat(agentKey, messages, (text) => {
        contentDiv.innerHTML = marked.parse(text);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    });

    if (result.type === 'error') {
        contentDiv.innerHTML = `<span style="color: #ef4444;">Error: ${result.error}</span>`;
        return "";
    }

    if (result.type === 'text') {
        contentDiv.innerHTML = marked.parse(result.content);
        return result.content;
    }
}
