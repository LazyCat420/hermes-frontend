// Configuration for the 3 standalone Hermes endpoints
const AGENTS = {
    'dgx_spark_2': { id: 'dgx2', name: 'DGX Spark 2 (Primary)', url: '/api/dgx2/v1/chat/completions', model: 'Qwen/Qwen3.5-72B' },
    'dgx_spark_1': { id: 'dgx1', name: 'DGX Spark 1', url: '/api/dgx1/v1/chat/completions', model: 'Intel/Qwen3.5-122B' },
    'jetson': { id: 'jetson', name: 'Jetson Orin AGX 64GB', url: '/api/jetson/v1/chat/completions', model: 'Kbenkhalad/Qwen3.5-35B' }
};

// Persistence State
const STORAGE_KEY = 'hermes_sessions';
let currentSessionId = null;
const DEFAULT_SYSTEM_PROMPT = {
    role: "system",
    content: "You are part of a 3-agent swarm (Jetson, DGX1, DGX2). Coordinate and execute tasks intelligently. If your tool fails or you cannot complete your task, explicitly include the exact phrase 'TASK FAILED' in your response so other agents can step in."
};
let globalHistory = [DEFAULT_SYSTEM_PROMPT];

// UI Elements
const chatHistory = document.getElementById('chatHistory');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChatBtn');

// Helper to generate IDs
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// Persistence Methods
function loadSessionsFromStorage() {
    const sessions = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const list = document.getElementById('sessionList');
    if (!list) return;
    list.innerHTML = '';
    sessions.forEach(s => {
        const div = document.createElement('div');
        div.className = `session-item ${s.id === currentSessionId ? 'active' : ''}`;
        
        div.innerHTML = `
            <div class="session-info" onclick="loadSession('${s.id}')">
                <div class="session-title">${s.title || 'New Chat'}</div>
                <div class="session-date">${new Date(s.date).toLocaleString()}</div>
            </div>
            <button class="delete-btn" onclick="deleteSession('${s.id}', event)" title="Delete Chat">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;
        list.appendChild(div);
    });
}

function deleteSession(id, event) {
    event.stopPropagation(); // Prevent loading the session when clicking delete
    let sessions = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    sessions = sessions.filter(s => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    
    if (currentSessionId === id) {
        startNewChat();
    } else {
        loadSessionsFromStorage();
    }
}

function saveCurrentSession() {
    const sessions = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const existingIndex = sessions.findIndex(s => s.id === currentSessionId);
    
    let title = "New Chat";
    const firstUserMsg = globalHistory.find(m => m.role === 'user' && !m.content.startsWith('SYSTEM'));
    if (firstUserMsg) {
        title = firstUserMsg.content.substring(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
    }

    const sessionData = {
        id: currentSessionId,
        title: title,
        date: Date.now(),
        history: globalHistory
    };

    if (existingIndex >= 0) {
        sessions[existingIndex] = sessionData;
    } else {
        sessions.unshift(sessionData);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    loadSessionsFromStorage();
}

function loadSession(id) {
    const sessions = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const session = sessions.find(s => s.id === id);
    if (session) {
        currentSessionId = id;
        globalHistory = session.history;
        renderHistory();
        loadSessionsFromStorage();
    }
}

function startNewChat() {
    currentSessionId = generateId();
    globalHistory = [DEFAULT_SYSTEM_PROMPT];
    renderHistory();
    saveCurrentSession();
}

function renderHistory() {
    chatHistory.innerHTML = '<div class="system-message">System initialized. Connected to Hermes Hub.</div>';
    globalHistory.forEach(msg => {
        if (msg.role === 'system' && msg.content === DEFAULT_SYSTEM_PROMPT.content) return; // skip initial prompt
        
        let senderName = '';
        if (msg.role === 'system') senderName = 'System';
        if (msg.role === 'user') senderName = 'You';
        if (msg.role === 'assistant') senderName = 'Hermes Orchestrator';
        
        appendMessage(msg.role, msg.content, senderName);
    });
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    const sessions = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (sessions.length > 0) {
        currentSessionId = sessions[0].id; // load most recent
        loadSession(currentSessionId);
    } else {
        startNewChat();
    }
});

newChatBtn.addEventListener('click', startNewChat);

function getActiveAgents() {
    const active = Object.keys(AGENTS).filter(agentKey => {
        const checkbox = document.getElementById(`enable-${AGENTS[agentKey].id}`);
        return checkbox ? checkbox.checked : true;
    });
    return active.length > 0 ? active : ['dgx_spark_2'];
}

messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight < 150 ? this.scrollHeight : 150) + 'px';
});

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
    saveCurrentSession();

    const activeAgents = getActiveAgents();

    const huddleLoader = appendMessage('system', '<div class="typing-indicator" style="display:inline-block; margin-right: 10px;"><span></span><span></span><span></span></div> <i>Initiating Agent Huddle...</i>', 'System');
    
    const huddlePromises = activeAgents.map(async (agentKey) => {
        const huddleMessages = [...globalHistory, {
            role: "user", 
            content: "SYSTEM HUDDLE: Before executing any tools, propose a brief 1-sentence strategy for how you will help answer the user's latest request. Do NOT execute tools yet. Just state your plan."
        }];
        const result = await streamChat(agentKey, huddleMessages, () => {});
        return { agent: AGENTS[agentKey].name, strategy: result.content };
    });

    const strategies = await Promise.all(huddlePromises);
    
    huddleLoader.parentElement.remove();

    let huddleSummary = "**STRATEGY HUDDLE COMPLETE:**\n\n";
    strategies.forEach(s => {
        huddleSummary += `- **${s.agent}**: ${s.strategy}\n`;
    });
    
    appendMessage('system', huddleSummary, 'Huddle Summary');
    globalHistory.push({ role: "system", content: huddleSummary + "\nNow, execute your part of the strategy using your native tools to fulfill the user's original request." });
    saveCurrentSession();

    Promise.all(activeAgents.map(ak => orchestrate(ak, [...globalHistory]))).then(async (results) => {
        let combinedResponse = "";
        let hasFailure = false;
        let failedAgents = [];

        results.forEach((res, i) => {
            const agentName = AGENTS[activeAgents[i]].name;
            combinedResponse += `[${agentName}]: ${res}\n`;

            if (res.includes("Error:") || res.includes("TASK FAILED")) {
                 hasFailure = true;
                 failedAgents.push(agentName);
            }
        });

        globalHistory.push({ role: "assistant", content: combinedResponse });
        saveCurrentSession();

        if (hasFailure && activeAgents.length > 1) {
            appendMessage('system', `<div class="typing-indicator" style="display:inline-block; margin-right: 10px;"><span></span><span></span><span></span></div> <i>Failure detected from ${failedAgents.join(', ')}. Initiating Recovery Phase...</i>`, 'System');
            
            globalHistory.push({ role: "user", content: "SYSTEM ALERT: One or more agents encountered a failure. Can another agent try a different approach to solve the user's request?" });
            saveCurrentSession();
            
            const recoveryResults = await Promise.all(activeAgents.map(ak => orchestrate(ak, [...globalHistory])));
            
            let recoveryCombined = "";
            recoveryResults.forEach((res, i) => {
                recoveryCombined += `[${AGENTS[activeAgents[i]].name}]: ${res}\n`;
            });
            globalHistory.push({ role: "assistant", content: recoveryCombined });
            saveCurrentSession();
        }

        sendBtn.disabled = false;
        messageInput.focus();
    });
});

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

// ----------------------------------------------------
// Theme Settings Logic
// ----------------------------------------------------
const THEME_STORAGE_KEY = 'hermes_theme_v1';

const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveThemeBtn = document.getElementById('saveThemeBtn');

const primaryInput = document.getElementById('primaryColorInput');
const secondaryInput = document.getElementById('secondaryColorInput');
const bgInput = document.getElementById('bgColorInput');

function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
}

function applyTheme(primary, secondary, bg) {
    document.documentElement.style.setProperty('--primary-rgb', hexToRgb(primary));
    document.documentElement.style.setProperty('--secondary-rgb', hexToRgb(secondary));
    document.documentElement.style.setProperty('--bg-rgb', hexToRgb(bg));
    
    // Also update inputs to match loaded theme
    if (primaryInput) primaryInput.value = primary;
    if (secondaryInput) secondaryInput.value = secondary;
    if (bgInput) bgInput.value = bg;
}

function loadTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved) {
        const theme = JSON.parse(saved);
        applyTheme(theme.primary, theme.secondary, theme.bg);
    } else {
        // Default Soft Cyan Theme
        applyTheme('#00e5ff', '#0099cc', '#050e14');
    }
}

// Event Listeners for Modal
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'flex';
    });
}

if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'none';
        loadTheme(); // revert to saved if they didn't save
    });
}

if (saveThemeBtn) {
    saveThemeBtn.addEventListener('click', () => {
        const newTheme = {
            primary: primaryInput.value,
            secondary: secondaryInput.value,
            bg: bgInput.value
        };
        localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(newTheme));
        applyTheme(newTheme.primary, newTheme.secondary, newTheme.bg);
        settingsModal.style.display = 'none';
    });
}

// Live preview while dragging color picker
[primaryInput, secondaryInput, bgInput].forEach(input => {
    if (input) {
        input.addEventListener('input', () => {
            applyTheme(primaryInput.value, secondaryInput.value, bgInput.value);
        });
    }
});

// Load theme on startup
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
});
