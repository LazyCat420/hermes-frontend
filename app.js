// Configuration for the 3 standalone Hermes endpoints
const AGENTS = {
    'dgx_spark_2': { id: 'dgx2', name: 'DGX Spark 2 (Primary)', url: '/api/dgx2/v1/chat/completions', model: 'Qwen/Qwen3.5-72B' },
    'dgx_spark_1': { id: 'dgx1', name: 'DGX Spark 1', url: '/api/dgx1/v1/chat/completions', model: 'Intel/Qwen3.5-122B' },
    'jetson': { id: 'jetson', name: 'Jetson Orin AGX 64GB', url: '/api/jetson/v1/chat/completions', model: 'Kbenkhalad/Qwen3.5-35B' }
};

// Persistence State
const STORAGE_KEY = 'hermes_sessions';
let DEFAULT_SYSTEM_PROMPT = {
    role: "system",
    content: "You are part of a 3-agent swarm (Jetson, DGX1, DGX2). Coordinate and execute tasks intelligently. If your tool fails or you cannot complete your task, explicitly include the exact phrase 'TASK FAILED' in your response so other agents can step in. ALWAYS cite your sources using clickable markdown links, e.g., [Title](url), so the user can verify the data."
};
let globalHistory = [DEFAULT_SYSTEM_PROMPT];
let currentSessionId = null;
let processingSessions = {};
let sessionDOMs = {};
let globalMissionStates = {}; // sessionId -> missionState
let activeArchetype = { x: 0, y: 0 };
let liveArchetypes = [];

// UI Elements
const chatContainerWrapper = document.getElementById('chatContainerWrapper');
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
chatContainerWrapper.addEventListener('click', (e) => {
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
        
        const state = globalMissionStates[s.id];
        const isProcessing = state && state.status && state.status !== 'complete';
        const processingHtml = isProcessing ? `<div class="processing-spinner" title="Processing..."></div>` : '';

        div.innerHTML = `
            <div class="session-info" onclick="loadSession('${s.id}')">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="session-title">${s.title || 'New Chat'}</div>
                    ${processingHtml}
                </div>
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

function saveSession(id, history, missionState = null) {
    const sessions = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const existingIndex = sessions.findIndex(s => s.id === id);
    let title = history.length > 1 ? history[1].content.substring(0, 30) + '...' : 'New Chat';
    
    if (missionState) {
        globalMissionStates[id] = missionState;
    } else if (globalMissionStates[id]) {
        missionState = globalMissionStates[id];
    }

    const sessionData = {
        id: id,
        title: title,
        date: existingIndex >= 0 ? sessions[existingIndex].date : Date.now(),
        history: history,
        missionState: missionState || null
    };

    if (existingIndex >= 0) {
        sessions[existingIndex] = sessionData;
    } else {
        sessions.unshift(sessionData);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    loadSessionsFromStorage();
}


// Incremental save helper
let saveTimeout;
function throttledSaveSession(id, history, state) {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveSession(id, history, state), 500);
}

function restoreStoryboard(state, container, sessionId) {
    const storyboardMsg = appendMessage('system', '', 'Mission Storyboard', true, container);
    
    // Determine status text/color based on state.status
    let planStatus = "Round 1 (Proposals)";
    let planColor = "";
    if (state.status === "planning_round_2") planStatus = "Round 2 (Commitment)";
    if (["retrieval", "checkpoint", "synthesis", "complete"].includes(state.status)) {
        planStatus = "Locked";
        planColor = "color: #10b981; animation: none;";
    }
    
    let findingsDisplay = ["retrieval", "checkpoint", "synthesis", "complete"].includes(state.status) ? "flex" : "none";
    let findStatus = "Retrieval in progress";
    let findColor = "";
    if (["checkpoint", "synthesis", "complete"].includes(state.status)) {
        findStatus = "Complete";
        findColor = "color: #10b981; animation: none;";
    }
    
    let cpDisplay = ["checkpoint", "synthesis", "complete"].includes(state.status) ? "flex" : "none";
    let cpStatus = "Evaluating";
    let cpColor = "";
    if (["synthesis", "complete"].includes(state.status)) {
        cpStatus = "Locked";
        cpColor = "color: #10b981; animation: none;";
    }

    storyboardMsg.innerHTML = `
        <div class="mission-storyboard">
            <div class="board-panel" id="planning-board-${sessionId}">
                <div class="board-header">Planning Board <span class="board-status" style="${planColor}">${planStatus}</span></div>
                <div class="board-content"></div>
            </div>
            <div class="board-panel" id="findings-board-${sessionId}" style="display: ${findingsDisplay};">
                <div class="board-header">Findings Board <span class="board-status" style="${findColor}">${findStatus}</span></div>
                <div class="board-content findings-grid"></div>
            </div>
            <div class="board-panel" id="checkpoint-board-${sessionId}" style="display: ${cpDisplay};">
                <div class="board-header">Checkpoint <span class="board-status" style="${cpColor}">${cpStatus}</span></div>
                <div class="board-content"></div>
            </div>
        </div>
    `;

    // Populate Planning Board
    const planContent = storyboardMsg.querySelector(`#planning-board-${sessionId} .board-content`);
    
    if (["planning_round_1"].includes(state.status)) {
        Object.entries(state.planningBoard.round1Proposals || {}).forEach(([agentKey, text]) => {
            const agentName = AGENTS[agentKey]?.name || agentKey;
            const div = document.createElement('div');
            div.className = 'agent-contribution';
            div.innerHTML = `<div class="agent-role">${agentName}</div><div class="agent-text">${marked.parse(text || '')}</div>`;
            planContent.appendChild(div);
        });
        
    } else {
        Object.entries(state.planningBoard.finalAssignments || {}).forEach(([agentKey, text]) => {
            const agentName = AGENTS[agentKey]?.name || agentKey;
            const div = document.createElement('div');
            div.className = 'agent-contribution';
            div.innerHTML = `<div class="agent-role">${agentName}</div><div class="agent-text">${marked.parse(text || '')}</div>`;
            planContent.appendChild(div);
        });
        
    }

    // Populate Findings Board
    if (findingsDisplay === "flex") {
        const findingsContent = storyboardMsg.querySelector(`#findings-board-${sessionId} .board-content`);
        (state.findingsBoard || []).forEach(f => {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'finding-card';
            if (f.agent.includes('(Follow-up)')) cardDiv.style.border = '1px solid rgba(245, 158, 11, 0.4)';
            cardDiv.innerHTML = `<div class="finding-source">${f.agent}</div><div class="finding-text">${marked.parse(f.content || '')}</div>`;
            findingsContent.appendChild(cardDiv);
        });
        
    }

    // Populate Checkpoint Board
    if (cpDisplay === "flex") {
        const cpContent = storyboardMsg.querySelector(`#checkpoint-board-${sessionId} .board-content`);
        if (state.checkpointBoard.analysis) {
            const cpDiv = document.createElement('div');
            cpDiv.className = 'agent-contribution';
            cpDiv.innerHTML = `<div class="agent-role">Evaluator</div><div class="agent-text">${marked.parse(state.checkpointBoard.analysis)}</div>`;
            cpContent.appendChild(cpDiv);
            
            const decDiv = document.createElement('div');
            if (state.checkpointBoard.analysis.includes('CONSENSUS: FALSE')) {
                decDiv.className = 'checkpoint-decision consensus-false';
                decDiv.innerText = 'CONSENSUS: FALSE - Triggering Follow-up Pass';
            } else {
                decDiv.className = 'checkpoint-decision consensus-true';
                decDiv.innerText = 'CONSENSUS: TRUE - Proceeding to Synthesis';
            }
            cpContent.appendChild(decDiv);
        }
    }
}

function saveCurrentSession() {
    saveSession(currentSessionId, globalHistory);
}

function switchChatContainer(id) {
    Object.values(sessionDOMs).forEach(el => el.style.display = 'none');
    
    if (!sessionDOMs[id]) {
        const div = document.createElement('div');
        div.className = 'chat-history';
        div.id = `chatHistory-${id}`;
        chatContainerWrapper.appendChild(div);
        sessionDOMs[id] = div;
    }
    
    sessionDOMs[id].style.display = 'flex';
    sessionDOMs[id].scrollTop = sessionDOMs[id].scrollHeight;
    
    sendBtn.disabled = !!processingSessions[id];
}

function loadSession(id) {
    const sessions = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const session = sessions.find(s => s.id === id);
    if (session) {
        currentSessionId = id;
        switchChatContainer(id);
        
        globalHistory = session.history;
        if (session.missionState) globalMissionStates[id] = session.missionState;
        renderHistory();
        
        if (session.missionState && session.missionState.status !== 'complete' && !processingSessions[id]) {
            resumeMission(id, session.history, session.missionState);
        }
        
        loadSessionsFromStorage();
    }
}

function startNewChat() {
    currentSessionId = generateId();
    switchChatContainer(currentSessionId);
    globalHistory = [DEFAULT_SYSTEM_PROMPT];
    globalMissionStates[currentSessionId] = null;
    renderHistory();
    saveCurrentSession();
}

function renderHistory() {
    const container = sessionDOMs[currentSessionId];
    if (!container) return;
    container.innerHTML = '<div class="system-message">System initialized. Connected to Hermes Hub.</div>';
    
    const mState = globalMissionStates[currentSessionId];
    
    globalHistory.forEach((msg, idx) => {
        if (msg.role === 'system' && msg.content === DEFAULT_SYSTEM_PROMPT.content) return; // skip initial prompt
        
        // Hide intermediate backend system contexts if missionState exists
        if (mState && msg.role === 'system' && msg.content.startsWith('TEAM PLAN LOCK')) return;
        if (mState && msg.role === 'system' && msg.content.startsWith('EVIDENCE FOUND')) return;
        if (mState && msg.role === 'system' && msg.content.startsWith('CHECKPOINT FAILED')) return;

        let senderName = '';
        if (msg.role === 'system') senderName = 'System';
        if (msg.role === 'user') senderName = 'You';
        if (msg.role === 'assistant') senderName = 'Hermes Orchestrator';
        
        if (msg.displayContent) {
            appendMessage(msg.role, msg.displayContent, senderName, true, container);
        } else {
            appendMessage(msg.role, msg.content, senderName, false, container);
        }
        
        // Inject storyboard after user message if this was the last mission run
        let lastUserIdx = -1;
        for(let i=globalHistory.length-1; i>=0; i--) {
            if(globalHistory[i].role === 'user') { lastUserIdx = i; break; }
        }
        
        if (mState && idx === lastUserIdx && msg.role === 'user') {
            restoreStoryboard(mState, container, currentSessionId);
        }
    });
    
    
    
    container.scrollTop = container.scrollHeight;
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Phase 1/3: Fetch live evolution data and set active archetype / prompt
    try {
        const res = await fetch('http://localhost:3000/api/dashboard/evolution');
        const json = await res.json();
        if (json.data && json.data.length > 0) {
            liveArchetypes = json.data;
            const elites = liveArchetypes.filter(a => a.is_elite).sort((a, b) => b.score - a.score);
            const best = elites.length > 0 ? elites[0] : liveArchetypes[0];
            activeArchetype = { x: best.x, y: best.y };
            if (best.system_prompt) {
                DEFAULT_SYSTEM_PROMPT.content = best.system_prompt;
                if (globalHistory.length > 0 && globalHistory[0].role === 'system') {
                    globalHistory[0].content = best.system_prompt;
                }
            }
        }
    } catch (e) {
        console.error("Failed to fetch initial evolution data", e);
    }

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

function resumeMission(id, history, missionState) {
    processingSessions[id] = true;
    if (currentSessionId === id) {
        sendBtn.disabled = true;
    }
    const thisContainer = sessionDOMs[id];
    const activeAgents = getActiveAgents();
    
    missionState.partialStreams = {};
    saveSession(id, history, missionState);
    
    executeMission(id, history, missionState, activeAgents, missionState.objective, thisContainer);
}

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = '';
    messageInput.style.height = 'auto';

    const thisSessionId = currentSessionId;
    const thisContainer = sessionDOMs[thisSessionId];
    let thisHistory = [...globalHistory];
    
    processingSessions[thisSessionId] = true;
    if (currentSessionId === thisSessionId) {
        sendBtn.disabled = true;
    }

    appendMessage('user', text, 'You', false, thisContainer);
    thisHistory.push({ role: 'user', content: text });
    
    let missionState = {
        objective: text,
        status: "planning_round_1",
        planningBoard: { round1Proposals: {}, finalAssignments: {} },
        findingsBoard: [],
        checkpointBoard: { missingEvidence: [], conflicts: [], consensusReached: false },
        partialStreams: {}
    };
    
    saveSession(thisSessionId, thisHistory, missionState);
    if (currentSessionId === thisSessionId) {
        globalHistory = [...thisHistory];
        globalMissionStates[thisSessionId] = missionState;
    }

    const activeAgents = getActiveAgents();
    executeMission(thisSessionId, thisHistory, missionState, activeAgents, text, thisContainer);
});

async function executeMission(thisSessionId, thisHistory, missionState, activeAgents, text, thisContainer) {
    let planningBoard = document.getElementById(`planning-board-${thisSessionId}`);
    let findingsBoard = document.getElementById(`findings-board-${thisSessionId}`);
    let checkpointBoard = document.getElementById(`checkpoint-board-${thisSessionId}`);
    
    if (!planningBoard) {
        const storyboardMsg = appendMessage('system', '', 'Mission Storyboard', true, thisContainer);
        storyboardMsg.innerHTML = `
            <div class="mission-storyboard">
                <div class="board-panel" id="planning-board-${thisSessionId}">
                    <div class="board-header">Planning Board <span class="board-status">Round 1 (Proposals)</span></div>
                    <div class="board-content"></div>
                </div>
                <div class="board-panel" id="findings-board-${thisSessionId}" style="display: none;">
                    <div class="board-header">Findings Board <span class="board-status">Retrieval in progress</span></div>
                    <div class="board-content findings-grid"></div>
                </div>
                <div class="board-panel" id="checkpoint-board-${thisSessionId}" style="display: none;">
                    <div class="board-header">Checkpoint <span class="board-status">Evaluating</span></div>
                    <div class="board-content"></div>
                </div>
            </div>
        `;
        planningBoard = document.getElementById(`planning-board-${thisSessionId}`);
        findingsBoard = document.getElementById(`findings-board-${thisSessionId}`);
        checkpointBoard = document.getElementById(`checkpoint-board-${thisSessionId}`);
    }

    const planningContent = planningBoard.querySelector('.board-content');
    const planningStatus = planningBoard.querySelector('.board-status');
    const findingsContent = findingsBoard.querySelector('.board-content');
    const checkpointContent = checkpointBoard.querySelector('.board-content');

    try {
        if (missionState.status === "planning_round_1") {
            planningStatus.innerText = "Round 1 (Proposals)";
            const round1Promises = activeAgents.map(async (agentKey) => {
                if (missionState.planningBoard.round1Proposals[agentKey]) {
                    return { agentKey, name: AGENTS[agentKey].name, content: missionState.planningBoard.round1Proposals[agentKey] };
                }

                const agentName = AGENTS[agentKey].name;
                const prompt = `MISSION: "${text}". Propose a soft role (Scout, Analyst, or Synthesist) and a 1-sentence strategy for what you will investigate. DO NOT execute tools yet.`;
                
                const agentDiv = document.createElement('div');
                agentDiv.className = 'agent-contribution';
                agentDiv.innerHTML = `<div class="agent-role">${agentName}</div><div class="agent-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
                planningContent.appendChild(agentDiv);
                const textDiv = agentDiv.querySelector('.agent-text');
                
                const result = await streamChat(agentKey, [...thisHistory, { role: 'user', content: prompt }], (chunk) => {
                    textDiv.innerHTML = marked.parse(chunk);
                    thisContainer.scrollTop = thisContainer.scrollHeight;
                    missionState.partialStreams = missionState.partialStreams || {};
                    missionState.partialStreams[agentKey] = chunk;
                    throttledSaveSession(thisSessionId, thisHistory, missionState);
                }, thisContainer);
                
                missionState.planningBoard.round1Proposals[agentKey] = result.content;
                delete missionState.partialStreams[agentKey];
                saveSession(thisSessionId, thisHistory, missionState);
                return { agentKey, name: agentName, content: result.content };
            });
            
            await Promise.all(round1Promises);
            missionState.status = "planning_round_2";
            saveSession(thisSessionId, thisHistory, missionState);
        }

        if (missionState.status === "planning_round_2") {
            planningStatus.innerText = "Round 2 (Commitment)";
            
            let round1Context = "ROUND 1 PROPOSALS:\n";
            Object.entries(missionState.planningBoard.round1Proposals).forEach(([ak, content]) => {
                round1Context += `- ${AGENTS[ak]?.name || ak}: ${content}\n`;
            });
            
            for (const agentKey of activeAgents) {
                if (missionState.planningBoard.finalAssignments[agentKey]) continue;

                const agentName = AGENTS[agentKey].name;
                const prompt = `MISSION: "${text}".\n\n${round1Context}\n\nBased on the team's proposals, lock in your final role and specific task assignment. If someone else took your target, PIVOT to a new non-overlapping target. Output your final 1-sentence commitment.`;
                
                const agentDiv = document.createElement('div');
                agentDiv.className = 'agent-contribution';
                agentDiv.innerHTML = `<div class="agent-role">${agentName}</div><div class="agent-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
                planningContent.appendChild(agentDiv);
                const textDiv = agentDiv.querySelector('.agent-text');
                
                const result = await streamChat(agentKey, [...thisHistory, { role: 'user', content: prompt }], (chunk) => {
                    textDiv.innerHTML = marked.parse(chunk);
                    thisContainer.scrollTop = thisContainer.scrollHeight;
                    missionState.partialStreams = missionState.partialStreams || {};
                    missionState.partialStreams[agentKey] = chunk;
                    throttledSaveSession(thisSessionId, thisHistory, missionState);
                }, thisContainer);
                
                missionState.planningBoard.finalAssignments[agentKey] = result.content;
                delete missionState.partialStreams[agentKey];
                saveSession(thisSessionId, thisHistory, missionState);
            }
            
            planningStatus.innerText = "Locked";
            planningStatus.style.animation = "none";
            planningStatus.style.color = "#10b981";
            
            missionState.status = "retrieval";
            saveSession(thisSessionId, thisHistory, missionState);
            
            let teamPlanContext = "TEAM PLAN LOCK:\n";
            activeAgents.forEach(k => teamPlanContext += `- ${AGENTS[k]?.name || k}: ${missionState.planningBoard.finalAssignments[k]}\n`);
            thisHistory.push({ role: 'system', content: teamPlanContext });
        }

        if (missionState.status === "retrieval") {
            findingsBoard.style.display = 'flex';
            
            if (!thisHistory.find(h => h.role === 'system' && h.content && h.content.startsWith("TEAM PLAN LOCK"))) {
                let teamPlanContext = "TEAM PLAN LOCK:\n";
                activeAgents.forEach(k => teamPlanContext += `- ${AGENTS[k]?.name || k}: ${missionState.planningBoard.finalAssignments[k]}\n`);
                thisHistory.push({ role: 'system', content: teamPlanContext });
            }

            const retrievalPromises = [];
            const TARGET_CONCURRENCY = 6;
            const subagentsPerBox = Math.ceil(TARGET_CONCURRENCY / activeAgents.length);
            
            for (const agentKey of activeAgents) {
                for (let i = 1; i <= subagentsPerBox; i++) {
                    const agentName = AGENTS[agentKey].name;
                    const subAgentName = `${agentName} (Thread ${i})`;
                    
                    if (missionState.findingsBoard.find(f => f.agent === subAgentName)) {
                        retrievalPromises.push(Promise.resolve({ 
                            agent: subAgentName, 
                            result: missionState.findingsBoard.find(f => f.agent === subAgentName).content, 
                            error: null 
                        }));
                        continue;
                    }

                    const prompt = `Execute your locked task. **CRITICAL: You MUST use your native browser or search tools to fetch live data.** Do NOT hallucinate URLs or facts. Focus specifically on angle/sub-aspect ${i} of your strategy. If a tool fails, report 'TASK FAILED'. Output your findings strictly tagged with [CLAIM] your finding [/CLAIM] and [SOURCE] your source URL [/SOURCE].`;
                    
                    const cardDiv = document.createElement('div');
                    cardDiv.className = 'finding-card';
                    cardDiv.innerHTML = `<div class="finding-source">${subAgentName}</div><div class="finding-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
                    findingsContent.appendChild(cardDiv);
                    const textDiv = cardDiv.querySelector('.finding-text');
                    
                    const p = streamChat(agentKey, [...thisHistory, { role: 'user', content: prompt }], (chunk) => {
                        textDiv.innerHTML = marked.parse(chunk);
                        thisContainer.scrollTop = thisContainer.scrollHeight;
                        missionState.partialStreams = missionState.partialStreams || {};
                        missionState.partialStreams[subAgentName] = chunk;
                        throttledSaveSession(thisSessionId, thisHistory, missionState);
                    }, thisContainer).then(result => {
                        missionState.findingsBoard.push({ agent: subAgentName, content: result.content || result.error });
                        delete missionState.partialStreams[subAgentName];
                        saveSession(thisSessionId, thisHistory, missionState);
                        return { agent: subAgentName, result: result.content, error: result.error };
                    });
                    
                    retrievalPromises.push(p);
                }
            }
            
            await Promise.all(retrievalPromises);
            findingsBoard.querySelector('.board-status').innerText = "Complete";
            findingsBoard.querySelector('.board-status').style.animation = "none";
            findingsBoard.querySelector('.board-status').style.color = "#10b981";
            
            missionState.status = "checkpoint";
            saveSession(thisSessionId, thisHistory, missionState);
        }

        if (missionState.status === "checkpoint") {
            checkpointBoard.style.display = 'flex';
            
            if (!thisHistory.find(h => h.role === 'system' && h.content && h.content.startsWith("EVIDENCE FOUND"))) {
                let findingsContext = "EVIDENCE FOUND:\n";
                missionState.findingsBoard.forEach(f => {
                    if (!f.agent.includes('(Follow-up)')) {
                        findingsContext += `[${f.agent}]: ${f.content}\n`;
                    }
                });
                thisHistory.push({ role: 'system', content: findingsContext });
            }

            const evaluatorKey = activeAgents.includes('dgx_spark_2') ? 'dgx_spark_2' : activeAgents[0];
            const evaluatorName = AGENTS[evaluatorKey].name;
            let checkpointRounds = 1;
            let conflictResolutionTriggered = false;

            if (!missionState.checkpointBoard.analysis) {
                const cpDiv = document.createElement('div');
                cpDiv.className = 'agent-contribution';
                cpDiv.innerHTML = `<div class="agent-role">${evaluatorName} (Evaluator)</div><div class="agent-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
                checkpointContent.appendChild(cpDiv);
                const cpTextDiv = cpDiv.querySelector('.agent-text');
                
                const cpPrompt = `Review the EVIDENCE FOUND. Identify: 1. Conflicting claims. 2. Missing evidence required to fully answer the user's request. Output CONSENSUS: TRUE if we have enough verified data to proceed to final synthesis. Output CONSENSUS: FALSE and list the missing evidence if we need another retrieval pass.`;
                
                const cpResult = await streamChat(evaluatorKey, [...thisHistory, { role: 'user', content: cpPrompt }], (chunk) => {
                    cpTextDiv.innerHTML = marked.parse(chunk);
                    thisContainer.scrollTop = thisContainer.scrollHeight;
                    missionState.partialStreams = missionState.partialStreams || {};
                    missionState.partialStreams['evaluator'] = chunk;
                    throttledSaveSession(thisSessionId, thisHistory, missionState);
                }, thisContainer);
                
                const cpContent = cpResult.content || "";
                missionState.checkpointBoard.analysis = cpContent;
                delete missionState.partialStreams['evaluator'];
                saveSession(thisSessionId, thisHistory, missionState);
                
                if (cpContent.includes('CONSENSUS: FALSE')) {
                    conflictResolutionTriggered = true;
                    checkpointRounds++;
                    
                    const decDiv = document.createElement('div');
                    decDiv.className = 'checkpoint-decision consensus-false';
                    decDiv.innerText = 'CONSENSUS: FALSE - Triggering Follow-up Pass';
                    checkpointContent.appendChild(decDiv);
                    
                    thisHistory.push({ role: 'system', content: `CHECKPOINT FAILED: ${cpContent}\n\nPlease perform a targeted follow-up retrieval to resolve the gaps/conflicts.` });
                    
                    const followUpPromises = activeAgents.map(async (agentKey) => {
                        const agentName = AGENTS[agentKey].name;
                        const cardDiv = document.createElement('div');
                        cardDiv.className = 'finding-card';
                        cardDiv.style.border = '1px solid rgba(245, 158, 11, 0.4)';
                        cardDiv.innerHTML = `<div class="finding-source">${agentName} (Follow-up)</div><div class="finding-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
                        findingsContent.appendChild(cardDiv);
                        
                        const result = await streamChat(agentKey, [...thisHistory, { role: 'user', content: 'Execute follow-up retrieval to resolve the checkpoint gaps.' }], (chunk) => {
                            cardDiv.querySelector('.finding-text').innerHTML = marked.parse(chunk);
                            thisContainer.scrollTop = thisContainer.scrollHeight;
                            missionState.partialStreams = missionState.partialStreams || {};
                            missionState.partialStreams[agentName + ' (Follow-up)'] = chunk;
                            throttledSaveSession(thisSessionId, thisHistory, missionState);
                        }, thisContainer);
                        
                        missionState.findingsBoard.push({ agent: agentName + ' (Follow-up)', content: result.content });
                        delete missionState.partialStreams[agentName + ' (Follow-up)'];
                        saveSession(thisSessionId, thisHistory, missionState);
                        return result.content;
                    });
                    
                    await Promise.all(followUpPromises);
                } else {
                    const decDiv = document.createElement('div');
                    decDiv.className = 'checkpoint-decision consensus-true';
                    decDiv.innerText = 'CONSENSUS: TRUE - Proceeding to Synthesis';
                    checkpointContent.appendChild(decDiv);
                }
            } else {
                if (missionState.checkpointBoard.analysis.includes('CONSENSUS: FALSE')) {
                    conflictResolutionTriggered = true;
                    checkpointRounds++;
                    
                    const followups = missionState.findingsBoard.filter(f => f.agent.includes('(Follow-up)'));
                    if (followups.length < activeAgents.length) {
                        if (!thisHistory.find(h => h.role === 'system' && h.content && h.content.startsWith("CHECKPOINT FAILED"))) {
                            thisHistory.push({ role: 'system', content: `CHECKPOINT FAILED: ${missionState.checkpointBoard.analysis}\n\nPlease perform a targeted follow-up retrieval to resolve the gaps/conflicts.` });
                        }

                        const followUpPromises = activeAgents.map(async (agentKey) => {
                            const agentName = AGENTS[agentKey].name;
                            if (followups.find(f => f.agent === `${agentName} (Follow-up)`)) {
                                return Promise.resolve();
                            }
                            const cardDiv = document.createElement('div');
                            cardDiv.className = 'finding-card';
                            cardDiv.style.border = '1px solid rgba(245, 158, 11, 0.4)';
                            cardDiv.innerHTML = `<div class="finding-source">${agentName} (Follow-up)</div><div class="finding-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
                            findingsContent.appendChild(cardDiv);
                            
                            const result = await streamChat(agentKey, [...thisHistory, { role: 'user', content: 'Execute follow-up retrieval to resolve the checkpoint gaps.' }], (chunk) => {
                                cardDiv.querySelector('.finding-text').innerHTML = marked.parse(chunk);
                                thisContainer.scrollTop = thisContainer.scrollHeight;
                                missionState.partialStreams = missionState.partialStreams || {};
                                missionState.partialStreams[agentName + ' (Follow-up)'] = chunk;
                                throttledSaveSession(thisSessionId, thisHistory, missionState);
                            }, thisContainer);
                            
                            missionState.findingsBoard.push({ agent: agentName + ' (Follow-up)', content: result.content });
                            delete missionState.partialStreams[agentName + ' (Follow-up)'];
                            saveSession(thisSessionId, thisHistory, missionState);
                            return result.content;
                        });
                        await Promise.all(followUpPromises);
                    }
                }
            }
            
            checkpointBoard.querySelector('.board-status').innerText = "Locked";
            checkpointBoard.querySelector('.board-status').style.animation = "none";
            checkpointBoard.querySelector('.board-status').style.color = "#10b981";
            
            missionState.status = "synthesis";
            missionState.checkpointRounds = checkpointRounds;
            missionState.conflictResolutionTriggered = conflictResolutionTriggered;
            saveSession(thisSessionId, thisHistory, missionState);
        }

        if (missionState.status === "synthesis") {
            const synthStart = performance.now();
            const finalContentDiv = appendMessage('assistant', '<div class="typing-indicator"><span></span><span></span><span></span></div>', 'Hermes Orchestrator (Synthesis)', false, thisContainer);
            
            let fullFindings = "";
            missionState.findingsBoard.forEach(f => fullFindings += `[${f.agent}]: ${f.content}\n`);
            
            const synthMessages = [...thisHistory, { 
                role: "user", 
                content: `SYSTEM INSTRUCTION: You are the final Synthesist. Draft the final response to the user's original request using ONLY the verified data from the findings board:\n${fullFindings}\n\nENSURE you preserve and include clickable markdown links [Title](url).`
            }];
            
            const evaluatorKey = activeAgents.includes('dgx_spark_2') ? 'dgx_spark_2' : activeAgents[0];

            const finalResult = await streamChat(evaluatorKey, synthMessages, (chunk) => {
                finalContentDiv.innerHTML = marked.parse(chunk);
                thisContainer.scrollTop = thisContainer.scrollHeight;
                missionState.partialStreams = missionState.partialStreams || {};
                missionState.partialStreams['synthesis'] = chunk;
                throttledSaveSession(thisSessionId, thisHistory, missionState);
            }, thisContainer);
            
            const latency_ms = performance.now() - synthStart;
            const token_count = Math.round((finalResult.content || '').length / 4);
            
            thisHistory.push({ role: "assistant", content: finalResult.content });
            delete missionState.partialStreams['synthesis'];
            missionState.status = "complete";
            
            saveSession(thisSessionId, thisHistory, missionState);
            if (currentSessionId === thisSessionId) {
                globalHistory = [...thisHistory];
                globalMissionStates[thisSessionId] = missionState;
            }
            
            const successRate = finalResult.content && finalResult.content.includes('TASK FAILED') ? 0.2 : 1.0;
            fetch('http://localhost:3000/api/evals/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    x: activeArchetype.x,
                    y: activeArchetype.y,
                    success_rate: successRate,
                    tokens: token_count,
                    latency: latency_ms,
                    collaboration_rounds: missionState.checkpointRounds || 1,
                    conflict_resolution: missionState.conflictResolutionTriggered || false
                })
            }).catch(e => console.error("Auto-eval failed:", e));
            
            autoResearchTask(finalResult.content || '');
        }

    } catch (err) {
        console.error("Mission Execution Error", err);
        appendMessage('system', `<span style="color: #ef4444;">Mission interrupted: ${err.message}</span>`, 'System', true, thisContainer);
    } finally {
        processingSessions[thisSessionId] = false;
        if (currentSessionId === thisSessionId) {
            sendBtn.disabled = false;
            messageInput.focus();
        }
    }
}


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

function appendMessage(role, content, senderName = '', isHtml = false, targetContainer = null) {
    const container = targetContainer || sessionDOMs[currentSessionId];
    if (!container) return;

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
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    return contentDiv;
}

function appendToolCall(agentName, toolName, targetContainer = null) {
    if (targetContainer === "hidden") return;
    const container = targetContainer || sessionDOMs[currentSessionId];
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'tool-call-block';
    
    const header = document.createElement('div');
    header.className = 'tool-header';
    header.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 16 16 12 12 8"></polyline><line x1="8" y1="12" x2="16" y2="12"></line></svg>
        ${agentName} triggered native tool: <code>${toolName}</code>
    `;
    
    div.appendChild(header);
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
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
async function orchestrateHidden(agentKey, messages, toolContainer = null) {
    const result = await streamChat(agentKey, messages, null, toolContainer);
    if (result.type === 'error') {
        return `Error: ${result.error}`;
    }
    if (result.type === 'text') {
        return result.content;
    }
}
async function autoResearchTask(finalAnswer) {
    if (!finalAnswer) return;
    try {
        const researchPrompt = `Based on this answer: "${finalAnswer.substring(0, 300)}", generate ONE specific follow-up research question this swarm should investigate autonomously.`;
        const result = await orchestrateHidden('dgx_spark_2', [
            DEFAULT_SYSTEM_PROMPT,
            { role: 'user', content: researchPrompt }
        ], "hidden");
        await fetch('http://localhost:3000/api/research/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: result, source: 'auto' })
        });
    } catch (e) {
        console.error("Auto-research failed:", e);
    }
}

async function orchestrate(agentKey, messages) {
    const agentName = AGENTS[agentKey].name;
    const contentDiv = appendMessage('agent', '<div class="typing-indicator"><span></span><span></span><span></span></div>', agentName);
    
    const result = await streamChat(agentKey, messages, (text) => {
        contentDiv.innerHTML = marked.parse(text);
        if (toolContainer) { toolContainer.scrollTop = toolContainer.scrollHeight; }
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

function renderEvoGrid() {
    if (!evoGridCore) return;
    
    // Attempt to fetch live data if it hasn't been fetched yet
    fetch('http://localhost:3000/api/dashboard/evolution')
        .then(res => res.json())
        .then(json => {
            if (json.data) {
                liveArchetypes = json.data;
            }
            renderEvoGridUI();
        })
        .catch(e => {
            console.error("Failed to fetch live evolution grid", e);
            renderEvoGridUI();
        });
}

function renderEvoGridUI() {
    evoGridCore.innerHTML = '';
    
    // Y runs from 4 to 0 so 0 is at the bottom visually like a graph
    for (let y = 4; y >= 0; y--) {
        for (let x = 0; x < 5; x++) {
            const node = document.createElement('div');
            node.className = 'evo-node';
            
            // Find archetype from live DB data
            const arch = liveArchetypes.find(a => a.x === x && a.y === y);
            
            if (arch) {
                if (arch.is_elite) node.classList.add('elite');
                const score = typeof arch.score === 'number' ? arch.score.toFixed(2) : '0.00';
                node.innerHTML = `
                    <div class="node-label">${arch.label || 'Unknown'}</div>
                    <div class="node-score">${score}</div>
                `;
                
                node.addEventListener('click', () => {
                    document.querySelectorAll('.evo-node').forEach(n => n.classList.remove('active'));
                    node.classList.add('active');
                    
                    evoArchetypeDetails.innerHTML = `
                        <h3>Archetype: ${arch.label || 'Unknown'} ${arch.is_elite ? '⭐ (Elite)' : ''}</h3>
                        <p>Performance Score: ${score}</p>
                        <div class="genetics">
                            <div class="genetic-trait">Context: ${arch.memory_context || 'N/A'}</div>
                            <div class="genetic-trait">Temp: ${arch.temperature || 'N/A'}</div>
                            <div class="genetic-trait">Top P: ${arch.top_p || 'N/A'}</div>
                            <div class="genetic-trait">Tools: ${arch.tools_profile || 'N/A'}</div>
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
        const activeContainer = sessionDOMs[currentSessionId];
        if (activeContainer) activeContainer.scrollTop = activeContainer.scrollHeight;
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
