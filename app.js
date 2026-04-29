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

// Configure marked to handle links and line breaks
marked.use({
    gfm: true,
    breaks: true
});

// Intercept link clicks to open in a new tab safely
chatHistory.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link) {
        e.preventDefault();
        window.open(link.href, '_blank', 'noopener,noreferrer');
    }
});

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
        
        if (msg.displayContent) {
            appendMessage(msg.role, msg.displayContent, senderName, true);
        } else {
            appendMessage(msg.role, msg.content, senderName, false);
        }
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

    const huddleContainer = appendMessage('system', '<strong>STRATEGY HUDDLE IN PROGRESS...</strong><div id="huddle-blocks" style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;"></div>', 'System', true);
    const huddleBlocks = huddleContainer.querySelector('#huddle-blocks');

    let currentHuddleContext = "";
    const strategies = [];

    // Sequential Huddle so agents can read previous proposals and avoid overlap
    for (const agentKey of activeAgents) {
        const agentName = AGENTS[agentKey].name;
        
        const agentBlock = document.createElement('div');
        agentBlock.style.background = 'rgba(0,0,0,0.2)';
        agentBlock.style.padding = '8px 12px';
        agentBlock.style.borderRadius = '6px';
        agentBlock.style.borderLeft = '3px solid var(--text-secondary)';
        
        agentBlock.innerHTML = `<div style="font-size: 0.8rem; font-weight: bold; margin-bottom: 4px; color: var(--text-primary); text-transform: uppercase;">${agentName}</div><div class="huddle-text" style="font-size: 0.9rem;"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
        huddleBlocks.appendChild(agentBlock);
        const textDiv = agentBlock.querySelector('.huddle-text');

        let contextPrompt = `SYSTEM HUDDLE: You are ${agentName}. Before executing any tools, propose a brief 1-sentence strategy for how you will help answer the user's latest request. Do NOT execute tools yet. Just state your plan.`;
        
        if (currentHuddleContext !== "") {
            contextPrompt = `SYSTEM HUDDLE: You are ${agentName}. Here is what the other agents have proposed so far:\n${currentHuddleContext}\n\nPlease propose a brief 1-sentence strategy for how YOU will help answer the user's request. **CRITICAL: You must choose a DIFFERENT, non-overlapping approach or target different data sources from the agents above.** Do NOT execute tools yet. Just state your plan.`;
        }
        
        const huddleMessages = [...globalHistory, {
            role: "user", 
            content: contextPrompt
        }];
        
        const result = await streamChat(agentKey, huddleMessages, (text) => {
            textDiv.innerHTML = marked.parse(text);
            chatHistory.scrollTop = chatHistory.scrollHeight;
        });
        
        const finalStrategy = result.content || result.error;
        strategies.push({ agent: agentName, strategy: finalStrategy });
        currentHuddleContext += `- ${agentName}: ${finalStrategy}\n`;
    }

    let huddleSummary = "**STRATEGY HUDDLE COMPLETE:**\n\n";
    let staticHuddleHtml = `<strong>STRATEGY HUDDLE COMPLETE</strong><div id="huddle-blocks" style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">`;
    strategies.forEach(s => {
        huddleSummary += `- **${s.agent}**: ${s.strategy}\n`;
        staticHuddleHtml += `
            <div style="background: rgba(0,0,0,0.2); padding: 8px 12px; border-radius: 6px; border-left: 3px solid var(--text-secondary);">
                <div style="font-size: 0.8rem; font-weight: bold; margin-bottom: 4px; color: var(--text-primary); text-transform: uppercase;">${s.agent}</div>
                <div class="huddle-text" style="font-size: 0.9rem;">${marked.parse(s.strategy)}</div>
            </div>
        `;
    });
    staticHuddleHtml += `</div>`;
    
    // We already have the live rendering, so we just update the global history silently
    globalHistory.push({ 
        role: "system", 
        content: huddleSummary + "\nNow, execute YOUR SPECIFIC PART of the strategy using your native tools to fulfill the user's original request. DO NOT duplicate the work of the other agents.",
        displayContent: staticHuddleHtml
    });
    saveCurrentSession();

    // 2. Real-time Scratchpad / Execution Phase
    const detailsWrapper = document.createElement('div');
    detailsWrapper.innerHTML = `
        <div class="agent-work-details">
            <div class="agent-work-summary" style="font-weight: bold; margin-bottom: 8px;">Live Agent Scratchpads (${activeAgents.length} agents)</div>
            <div class="agent-work-content" id="live-scratchpads"></div>
        </div>
    `;
    const scratchpadMsgDiv = appendMessage('system', '', 'Execution Phase', true);
    scratchpadMsgDiv.innerHTML = '';
    scratchpadMsgDiv.appendChild(detailsWrapper);
    
    const liveContentDiv = detailsWrapper.querySelector('#live-scratchpads');

    const execPromises = activeAgents.map(async (agentKey) => {
        const agentName = AGENTS[agentKey].name;
        
        const blockDiv = document.createElement('div');
        blockDiv.className = 'individual-agent-block';
        blockDiv.innerHTML = `
            <div class="individual-agent-name">${agentName}</div>
            <div class="individual-agent-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>
        `;
        liveContentDiv.appendChild(blockDiv);
        const textDiv = blockDiv.querySelector('.individual-agent-text');
        
        const result = await streamChat(agentKey, [...globalHistory], (text) => {
            textDiv.innerHTML = marked.parse(text);
            chatHistory.scrollTop = chatHistory.scrollHeight;
        }, blockDiv);
        
        const content = result.content || result.error;
        const isError = result.type === 'error' || (content && (content.includes("Error:") || content.includes("TASK FAILED")));
        
        return { agent: agentName, result: content, isError: isError };
    });

    Promise.all(execPromises).then(async (results) => {
        let hasFailure = false;
        let failedAgents = [];
        let synthesizerContext = `Here are the individual findings from the agents:\n\n`;

        results.forEach((r) => {
            synthesizerContext += `--- [${r.agent}] ---\n${r.result}\n\n`;

            if (r.isError) {
                 hasFailure = true;
                 failedAgents.push(r.agent);
            }
        });

        // Update the header after execution finishes
        detailsWrapper.querySelector('.agent-work-summary').innerText = `Individual Agent Scratchpads (${activeAgents.length} agents)`;

        // 3. Synthesizer Phase
        const synthesizerKey = activeAgents.includes('dgx_spark_2') ? 'dgx_spark_2' : activeAgents[0];
        const synthesizerMessages = [
            ...globalHistory,
            { role: "user", content: "SYSTEM INSTRUCTION: " + synthesizerContext + "\n\nPlease synthesize the above findings into one final, unified response to the user's original request. If the agents had questions for the user, consolidate them into ONE unified question at the end. Do not mention that you are summarizing other agents, just provide the final answer directly as Hermes Orchestrator." }
        ];

        const finalContentDiv = appendMessage('assistant', '<div class="typing-indicator"><span></span><span></span><span></span></div>', 'Hermes Orchestrator');
        
        const finalResult = await streamChat(synthesizerKey, synthesizerMessages, (text) => {
            finalContentDiv.innerHTML = marked.parse(text);
            chatHistory.scrollTop = chatHistory.scrollHeight;
        });

        if (finalResult.type === 'text') {
            // Build the static HTML for history preservation (so next page reload shows it)
            let staticScratchpadHtml = `<div class="agent-work-content">`;
            results.forEach(r => {
                staticScratchpadHtml += `
                    <div class="individual-agent-block">
                        <div class="individual-agent-name">${r.agent}</div>
                        <div class="individual-agent-text">${marked.parse(r.result)}</div>
                    </div>
                `;
            });
            staticScratchpadHtml += `</div>`;
            
            const detailsHtml = `
                <div class="agent-work-details">
                    <div class="agent-work-summary" style="font-weight: bold; margin-bottom: 8px;">Individual Agent Scratchpads (${activeAgents.length} agents)</div>
                    ${staticScratchpadHtml}
                </div>
            `;
            
            // We append the scratchpad to the final system message in the UI so the user always sees it
            globalHistory.push({ 
                role: "assistant", 
                content: finalResult.content + "\n\n" + `[Scratchpad Data Omitted from LLM Context]`,
                displayContent: marked.parse(finalResult.content) + "\n\n" + detailsHtml
            });
            saveCurrentSession();
        } else if (finalResult.type === 'error') {
            finalContentDiv.innerHTML = `<span style="color: #ef4444;">Error during synthesis: ${finalResult.error}</span>`;
            globalHistory.push({ role: "assistant", content: `Error during synthesis: ${finalResult.error}` });
            saveCurrentSession();
        }

        if (hasFailure && activeAgents.length > 1) {
            appendMessage('system', `<div class="typing-indicator" style="display:inline-block; margin-right: 10px;"><span></span><span></span><span></span></div> <i>Failure detected from ${failedAgents.join(', ')}. Initiating Recovery Phase...</i>`, 'System');
            
            globalHistory.push({ role: "user", content: "SYSTEM ALERT: One or more agents encountered a failure. Can another agent try a different approach to solve the user's request?" });
            saveCurrentSession();
            
            // In recovery, we can just use the hidden orchestrate so it doesn't spam too much, or we could stream it. We'll use hidden.
            const recoveryResults = await Promise.all(activeAgents.map(ak => orchestrateHidden(ak, [...globalHistory])));
            
            let recoveryCombined = "";
            recoveryResults.forEach((res, i) => {
                recoveryCombined += `[${AGENTS[activeAgents[i]].name}]: ${res}\n`;
            });
            globalHistory.push({ role: "assistant", content: recoveryCombined });
            saveCurrentSession();
            
            appendMessage('assistant', recoveryCombined, 'Hermes Orchestrator (Recovery)');
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

function appendMessage(role, content, senderName = '', isHtml = false) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'message-sender';
    nameDiv.innerText = senderName || (role === 'user' ? 'You' : 'Hermes');
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = isHtml ? content : marked.parse(content || '');

    div.appendChild(nameDiv);
    div.appendChild(contentDiv);
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    return contentDiv;
}

function appendToolCall(agentName, toolName, targetContainer = null) {
    const div = document.createElement('div');
    div.className = 'tool-call-block';
    
    const header = document.createElement('div');
    header.className = 'tool-header';
    header.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 16 16 12 12 8"></polyline><line x1="8" y1="12" x2="16" y2="12"></line></svg>
        ${agentName} triggered native tool: <code>${toolName}</code>
    `;
    
    div.appendChild(header);
    
    if (targetContainer) {
        targetContainer.appendChild(div);
    } else {
        chatHistory.appendChild(div);
    }
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

async function streamChat(agentKey, messages, onChunk, toolContainer = null) {
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
                                appendToolCall(AGENTS[agentKey].name, data.tool_name, toolContainer);
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

async function orchestrateHidden(agentKey, messages) {
    const result = await streamChat(agentKey, messages, null);

    if (result.type === 'error') {
        return `Error: ${result.error}`;
    }

    if (result.type === 'text') {
        return result.content;
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

// ----------------------------------------------------
// MAP-Elites EvoGrid Logic
// ----------------------------------------------------
const evoGridBtn = document.getElementById('evoGridBtn');
const evoGridModal = document.getElementById('evoGridModal');
const closeEvoGridBtn = document.getElementById('closeEvoGridBtn');
const evoGridCore = document.getElementById('evoGridCore');
const evoArchetypeDetails = document.getElementById('evoArchetypeDetails');

const archetypes = [
    { x: 0, y: 0, label: "Static Recall", elite: false, score: 0.42, genetics: { memory: "8k", temp: 0.1, top_p: 0.9, tools: "strict" } },
    { x: 4, y: 4, label: "Chaotic Oracle", elite: true, score: 0.91, genetics: { memory: "128k", temp: 0.9, top_p: 0.95, tools: "exploratory" } },
    { x: 2, y: 2, label: "Balanced Guide", elite: true, score: 0.85, genetics: { memory: "32k", temp: 0.5, top_p: 0.9, tools: "adaptive" } },
    { x: 0, y: 4, label: "Rapid Innovator", elite: false, score: 0.65, genetics: { memory: "8k", temp: 0.8, top_p: 0.9, tools: "exploratory" } },
    { x: 4, y: 0, label: "Deep Archivist", elite: true, score: 0.88, genetics: { memory: "128k", temp: 0.2, top_p: 0.9, tools: "strict" } },
    { x: 1, y: 1, label: "Cautious Assistant", elite: false, score: 0.55, genetics: { memory: "16k", temp: 0.3, top_p: 0.9, tools: "strict" } },
    { x: 3, y: 3, label: "Creative Partner", elite: true, score: 0.82, genetics: { memory: "64k", temp: 0.7, top_p: 0.9, tools: "adaptive" } }
];

function renderEvoGrid() {
    if (!evoGridCore) return;
    evoGridCore.innerHTML = '';
    
    // Y runs from 4 to 0 so 0 is at the bottom visually like a graph
    for (let y = 4; y >= 0; y--) {
        for (let x = 0; x < 5; x++) {
            const node = document.createElement('div');
            node.className = 'evo-node';
            
            // Find archetype
            const arch = archetypes.find(a => a.x === x && a.y === y);
            
            if (arch) {
                if (arch.elite) node.classList.add('elite');
                node.innerHTML = `
                    <div class="node-label">${arch.label}</div>
                    <div class="node-score">${arch.score.toFixed(2)}</div>
                `;
                
                node.addEventListener('click', () => {
                    document.querySelectorAll('.evo-node').forEach(n => n.classList.remove('active'));
                    node.classList.add('active');
                    
                    evoArchetypeDetails.innerHTML = `
                        <h3>Archetype: ${arch.label} ${arch.elite ? '⭐ (Elite)' : ''}</h3>
                        <p>Performance Score: ${arch.score.toFixed(2)}</p>
                        <div class="genetics">
                            <div class="genetic-trait">Context: ${arch.genetics.memory}</div>
                            <div class="genetic-trait">Temp: ${arch.genetics.temp}</div>
                            <div class="genetic-trait">Top P: ${arch.genetics.top_p}</div>
                            <div class="genetic-trait">Tools: ${arch.genetics.tools}</div>
                        </div>
                    `;
                });
            } else {
                node.innerHTML = `<div style="opacity: 0.2;">Empty</div>`;
                node.addEventListener('click', () => {
                    document.querySelectorAll('.evo-node').forEach(n => n.classList.remove('active'));
                    node.classList.add('active');
                    evoArchetypeDetails.innerHTML = `
                        <h3>Unexplored Niche</h3>
                        <p>This intersection of Temporal Horizon and Exploration has not yet evolved a stable archetype.</p>
                    `;
                });
            }
            
            evoGridCore.appendChild(node);
        }
    }
}

if (evoGridBtn) {
    evoGridBtn.addEventListener('click', () => {
        evoGridModal.style.display = 'flex';
        renderEvoGrid();
    });
}

if (closeEvoGridBtn) {
    closeEvoGridBtn.addEventListener('click', () => {
        evoGridModal.style.display = 'none';
    });
}

// ----------------------------------------------------
// Tab Navigation Logic
// ----------------------------------------------------
const tabChatBtn = document.getElementById('tabChatBtn');
const tabDashBtn = document.getElementById('tabDashBtn');
const viewChat = document.getElementById('viewChat');
const viewDashboard = document.getElementById('viewDashboard');
const syncDbBtn = document.getElementById('syncDbBtn');
let pollingInterval = null;

async function fetchDashboardData(endpoint, containerId) {
    const container = document.querySelector(`#${containerId} .panel-content`);
    if (!container) return;
    
    try {
        const response = await fetch(`http://localhost:3000${endpoint}`);
        const result = await response.json();
        
        if (result.status === 'table_missing') {
            container.innerHTML = `<div class="system-message" style="margin-top: 20px;">[ Database connected, but table not found. Awaiting initialization from backend. ]</div>`;
            return;
        }
        
        if (result.status === 'error') {
            container.innerHTML = `<div class="system-message" style="margin-top: 20px; color: #ef4444;">[ Error: ${result.error} ]</div>`;
            return;
        }
        
        if (!result.data || result.data.length === 0) {
            container.innerHTML = `<div class="system-message" style="margin-top: 20px;">[ Table exists, but no data records found yet. ]</div>`;
            return;
        }
        
        let html = '<div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">';
        result.data.forEach((row, idx) => {
            html += `<div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; border-left: 2px solid var(--accent-blue);">
                <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 4px;">Record #${idx + 1}</div>
                <pre style="margin: 0; padding: 0; background: transparent; font-size: 0.8rem; overflow-x: hidden; white-space: pre-wrap;">${JSON.stringify(row, null, 2)}</pre>
            </div>`;
        });
        html += '</div>';
        
        container.innerHTML = html;
        
    } catch (e) {
        container.innerHTML = `<div class="system-message" style="margin-top: 20px; color: #ef4444;">[ Connection failed. Is proxy.py running? ]</div>`;
    }
}

async function syncDashboard() {
    if (syncDbBtn) syncDbBtn.style.opacity = '0.5';
    
    await Promise.all([
        fetchDashboardData('/api/dashboard/research', 'panelAutoResearch'),
        fetchDashboardData('/api/dashboard/evals', 'panelEvals'),
        fetchDashboardData('/api/dashboard/evolution', 'panelEvolution')
    ]);
    
    if (syncDbBtn) syncDbBtn.style.opacity = '1';
}

if (syncDbBtn) {
    syncDbBtn.addEventListener('click', syncDashboard);
}

const triggerMutateBtn = document.getElementById('triggerMutateBtn');
if (triggerMutateBtn) {
    triggerMutateBtn.addEventListener('click', async () => {
        triggerMutateBtn.innerText = 'MUTATING...';
        triggerMutateBtn.style.opacity = '0.5';
        try {
            // Pick a random spot for the new mutation to land (0-4)
            const rx = Math.floor(Math.random() * 5);
            const ry = Math.floor(Math.random() * 5);
            await fetch('http://localhost:3000/api/evolution/mutate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ x: rx, y: ry })
            });
            await syncDashboard(); // Force refresh
            if (typeof renderEvoGrid === 'function') renderEvoGrid(); // Update the 5x5 modal too if open
        } catch (e) {
            console.error('Mutation failed:', e);
        }
        triggerMutateBtn.innerText = 'TRIGGER MUTATION';
        triggerMutateBtn.style.opacity = '1';
    });
}

if (tabChatBtn && tabDashBtn) {
    tabChatBtn.addEventListener('click', () => {
        tabChatBtn.classList.add('active');
        tabDashBtn.classList.remove('active');
        viewChat.style.display = 'flex';
        viewDashboard.style.display = 'none';
        if (chatHistory) chatHistory.scrollTop = chatHistory.scrollHeight;
        if (pollingInterval) clearInterval(pollingInterval);
    });

    tabDashBtn.addEventListener('click', () => {
        tabDashBtn.classList.add('active');
        tabChatBtn.classList.remove('active');
        viewDashboard.style.display = 'flex';
        viewChat.style.display = 'none';
        
        syncDashboard();
        if (pollingInterval) clearInterval(pollingInterval);
        pollingInterval = setInterval(syncDashboard, 10000);
    });
}
