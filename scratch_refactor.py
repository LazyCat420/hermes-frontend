import re
import os

with open("app.js", "r", encoding="utf-8") as f:
    content = f.read()

new_submit_block = """chatForm.addEventListener('submit', async (e) => {
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
    
    // Initialize Mission State
    let missionState = {
        objective: text,
        status: "planning_round_1",
        planningBoard: { round1Proposals: {}, finalAssignments: {} },
        findingsBoard: [],
        checkpointBoard: { missingEvidence: [], conflicts: [], consensusReached: false }
    };
    
    saveSession(thisSessionId, thisHistory, missionState);
    if (currentSessionId === thisSessionId) {
        globalHistory = [...thisHistory];
        globalMissionStates[thisSessionId] = missionState;
    }

    const activeAgents = getActiveAgents();

    // Inject Storyboard UI
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
    
    const planningBoard = document.getElementById(`planning-board-${thisSessionId}`);
    const planningContent = planningBoard.querySelector('.board-content');
    const planningStatus = planningBoard.querySelector('.board-status');
    
    // ==========================================
    // PHASE 1: ROLE NEGOTIATION (2-ROUNDS)
    // ==========================================
    
    // Round 1: Parallel Proposals
    const round1Promises = activeAgents.map(async (agentKey) => {
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
        }, thisContainer);
        
        missionState.planningBoard.round1Proposals[agentKey] = result.content;
        return { agentKey, name: agentName, content: result.content };
    });
    
    const round1Results = await Promise.all(round1Promises);
    
    // Round 2: Sequential Commitment
    planningStatus.innerText = "Round 2 (Commitment)";
    planningContent.innerHTML = ""; // Clear for round 2
    
    let round1Context = "ROUND 1 PROPOSALS:\\n";
    round1Results.forEach(r => round1Context += `- ${r.name}: ${r.content}\\n`);
    
    for (const agentKey of activeAgents) {
        const agentName = AGENTS[agentKey].name;
        const prompt = `MISSION: "${text}".\\n\\n${round1Context}\\n\\nBased on the team's proposals, lock in your final role and specific task assignment. If someone else took your target, PIVOT to a new non-overlapping target. Output your final 1-sentence commitment.`;
        
        const agentDiv = document.createElement('div');
        agentDiv.className = 'agent-contribution';
        agentDiv.innerHTML = `<div class="agent-role">${agentName}</div><div class="agent-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
        planningContent.appendChild(agentDiv);
        const textDiv = agentDiv.querySelector('.agent-text');
        
        const result = await streamChat(agentKey, [...thisHistory, { role: 'user', content: prompt }], (chunk) => {
            textDiv.innerHTML = marked.parse(chunk);
            thisContainer.scrollTop = thisContainer.scrollHeight;
        }, thisContainer);
        
        missionState.planningBoard.finalAssignments[agentKey] = result.content;
    }
    
    planningStatus.innerText = "Locked";
    planningStatus.style.animation = "none";
    planningStatus.style.color = "#10b981";
    
    // ==========================================
    // PHASE 2: EVIDENCE RETRIEVAL
    // ==========================================
    const findingsBoard = document.getElementById(`findings-board-${thisSessionId}`);
    const findingsContent = findingsBoard.querySelector('.board-content');
    findingsBoard.style.display = 'flex';
    missionState.status = "retrieval";
    
    let teamPlanContext = "TEAM PLAN LOCK:\\n";
    activeAgents.forEach(k => teamPlanContext += `- ${AGENTS[k].name}: ${missionState.planningBoard.finalAssignments[k]}\\n`);
    
    thisHistory.push({ role: 'system', content: teamPlanContext });
    
    const retrievalPromises = activeAgents.map(async (agentKey) => {
        const agentName = AGENTS[agentKey].name;
        const prompt = `Execute your locked task using your native tools. Output your findings strictly tagged with [CLAIM] your finding [/CLAIM] and [SOURCE] your source [/SOURCE]. Do not hallucinate.`;
        
        const cardDiv = document.createElement('div');
        cardDiv.className = 'finding-card';
        cardDiv.innerHTML = `<div class="finding-source">${agentName}</div><div class="finding-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
        findingsContent.appendChild(cardDiv);
        const textDiv = cardDiv.querySelector('.finding-text');
        
        const result = await streamChat(agentKey, [...thisHistory, { role: 'user', content: prompt }], (chunk) => {
            textDiv.innerHTML = marked.parse(chunk);
            thisContainer.scrollTop = thisContainer.scrollHeight;
        }, thisContainer);
        
        missionState.findingsBoard.push({ agent: agentName, content: result.content || result.error });
        return { agent: agentName, result: result.content, error: result.error };
    });
    
    const retrievalResults = await Promise.all(retrievalPromises);
    findingsBoard.querySelector('.board-status').innerText = "Complete";
    findingsBoard.querySelector('.board-status').style.animation = "none";
    findingsBoard.querySelector('.board-status').style.color = "#10b981";
    
    // ==========================================
    // PHASE 3: MID-MISSION CHECKPOINT
    // ==========================================
    const checkpointBoard = document.getElementById(`checkpoint-board-${thisSessionId}`);
    const checkpointContent = checkpointBoard.querySelector('.board-content');
    checkpointBoard.style.display = 'flex';
    missionState.status = "checkpoint";
    
    let findingsContext = "EVIDENCE FOUND:\\n";
    retrievalResults.forEach(r => findingsContext += `[${r.agent}]: ${r.result}\\n`);
    thisHistory.push({ role: 'system', content: findingsContext });
    
    // Sequential Checkpoint evaluation
    let conflictResolutionTriggered = false;
    let checkpointRounds = 1;
    
    const evaluatorKey = activeAgents.includes('dgx_spark_2') ? 'dgx_spark_2' : activeAgents[0];
    const evaluatorName = AGENTS[evaluatorKey].name;
    
    const cpDiv = document.createElement('div');
    cpDiv.className = 'agent-contribution';
    cpDiv.innerHTML = `<div class="agent-role">${evaluatorName} (Evaluator)</div><div class="agent-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
    checkpointContent.appendChild(cpDiv);
    const cpTextDiv = cpDiv.querySelector('.agent-text');
    
    const cpPrompt = `Review the EVIDENCE FOUND. Identify: 1. Conflicting claims. 2. Missing evidence required to fully answer the user's request. Output CONSENSUS: TRUE if we have enough verified data to proceed to final synthesis. Output CONSENSUS: FALSE and list the missing evidence if we need another retrieval pass.`;
    
    const cpResult = await streamChat(evaluatorKey, [...thisHistory, { role: 'user', content: cpPrompt }], (chunk) => {
        cpTextDiv.innerHTML = marked.parse(chunk);
        thisContainer.scrollTop = thisContainer.scrollHeight;
    }, thisContainer);
    
    const cpContent = cpResult.content || "";
    missionState.checkpointBoard.analysis = cpContent;
    
    if (cpContent.includes('CONSENSUS: FALSE')) {
        conflictResolutionTriggered = true;
        checkpointRounds++;
        
        const decDiv = document.createElement('div');
        decDiv.className = 'checkpoint-decision consensus-false';
        decDiv.innerText = 'CONSENSUS: FALSE - Triggering Follow-up Pass';
        checkpointContent.appendChild(decDiv);
        
        // Phase 3b: Follow up pass
        thisHistory.push({ role: 'system', content: `CHECKPOINT FAILED: ${cpContent}\\n\\nPlease perform a targeted follow-up retrieval to resolve the gaps/conflicts.` });
        
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
            }, thisContainer);
            
            missionState.findingsBoard.push({ agent: agentName + ' (Follow-up)', content: result.content });
            return result.content;
        });
        
        await Promise.all(followUpPromises);
    } else {
        const decDiv = document.createElement('div');
        decDiv.className = 'checkpoint-decision consensus-true';
        decDiv.innerText = 'CONSENSUS: TRUE - Proceeding to Synthesis';
        checkpointContent.appendChild(decDiv);
    }
    
    checkpointBoard.querySelector('.board-status').innerText = "Locked";
    checkpointBoard.querySelector('.board-status').style.animation = "none";
    checkpointBoard.querySelector('.board-status').style.color = "#10b981";
    
    // ==========================================
    // PHASE 4: FINAL SYNTHESIS
    // ==========================================
    missionState.status = "synthesis";
    const synthStart = performance.now();
    const finalContentDiv = appendMessage('assistant', '<div class="typing-indicator"><span></span><span></span><span></span></div>', 'Hermes Orchestrator (Synthesis)', false, thisContainer);
    
    let fullFindings = "";
    missionState.findingsBoard.forEach(f => fullFindings += `[${f.agent}]: ${f.content}\\n`);
    
    const synthMessages = [...thisHistory, { 
        role: "user", 
        content: `SYSTEM INSTRUCTION: You are the final Synthesist. Draft the final response to the user's original request using ONLY the verified data from the findings board:\\n${fullFindings}\\n\\nENSURE you preserve and include clickable markdown links [Title](url).`
    }];
    
    const finalResult = await streamChat(evaluatorKey, synthMessages, (chunk) => {
        finalContentDiv.innerHTML = marked.parse(chunk);
        thisContainer.scrollTop = thisContainer.scrollHeight;
    }, thisContainer);
    
    const latency_ms = performance.now() - synthStart;
    const token_count = Math.round((finalResult.content || '').length / 4);
    
    thisHistory.push({ role: "assistant", content: finalResult.content });
    missionState.status = "complete";
    saveSession(thisSessionId, thisHistory, missionState);
    if (currentSessionId === thisSessionId) {
        globalHistory = [...thisHistory];
        globalMissionStates[thisSessionId] = missionState;
    }
    
    const successRate = finalResult.content && finalResult.content.includes('TASK FAILED') ? 0.2 : 1.0;
    fetch('http://localhost:3005/api/evals/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            x: activeArchetype.x,
            y: activeArchetype.y,
            success_rate: successRate,
            tokens: token_count,
            latency: latency_ms,
            collaboration_rounds: checkpointRounds,
            conflict_resolution: conflictResolutionTriggered
        })
    }).catch(e => console.error("Auto-eval failed:", e));
    
    autoResearchTask(finalResult.content || '');

    processingSessions[thisSessionId] = false;
    if (currentSessionId === thisSessionId) {
        sendBtn.disabled = false;
        messageInput.focus();
    }
});"""

start_str = "chatForm.addEventListener('submit', async (e) => {"
end_str = "        processingSessions[thisSessionId] = false;\n        if (currentSessionId === thisSessionId) {\n            sendBtn.disabled = false;\n            messageInput.focus();\n        }\n    });\n});"

pattern = re.compile(re.escape(start_str) + r".*?" + re.escape(end_str), re.DOTALL)

if pattern.search(content):
    content = pattern.sub(new_submit_block, content)
    with open("app.js", "w", encoding="utf-8") as f:
        f.write(content)
    print("Successfully replaced submit block.")
else:
    print("Could not find submit block to replace.")
