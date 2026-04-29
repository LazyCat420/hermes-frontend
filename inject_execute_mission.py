import os

app_file = "d:/Github/hermes-frontend/app.js"
with open(app_file, "r", encoding="utf-8") as f:
    content = f.read()

submit_start_idx = content.find("chatForm.addEventListener('submit', async (e) => {")
submit_end_idx = content.find("function setAgentStatus")

if submit_start_idx != -1 and submit_end_idx != -1:
    # Everything from submit_start_idx up to submit_end_idx is the old submit block.
    # We will replace it!
    
    new_logic = """function resumeMission(id, history, missionState) {
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
            
            let round1Context = "ROUND 1 PROPOSALS:\\n";
            Object.entries(missionState.planningBoard.round1Proposals).forEach(([ak, content]) => {
                round1Context += `- ${AGENTS[ak]?.name || ak}: ${content}\\n`;
            });
            
            for (const agentKey of activeAgents) {
                if (missionState.planningBoard.finalAssignments[agentKey]) continue;

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
            
            let teamPlanContext = "TEAM PLAN LOCK:\\n";
            activeAgents.forEach(k => teamPlanContext += `- ${AGENTS[k]?.name || k}: ${missionState.planningBoard.finalAssignments[k]}\\n`);
            thisHistory.push({ role: 'system', content: teamPlanContext });
        }

        if (missionState.status === "retrieval") {
            findingsBoard.style.display = 'flex';
            
            if (!thisHistory.find(h => h.role === 'system' && h.content && h.content.startsWith("TEAM PLAN LOCK"))) {
                let teamPlanContext = "TEAM PLAN LOCK:\\n";
                activeAgents.forEach(k => teamPlanContext += `- ${AGENTS[k]?.name || k}: ${missionState.planningBoard.finalAssignments[k]}\\n`);
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
                let findingsContext = "EVIDENCE FOUND:\\n";
                missionState.findingsBoard.forEach(f => {
                    if (!f.agent.includes('(Follow-up)')) {
                        findingsContext += `[${f.agent}]: ${f.content}\\n`;
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
                            thisHistory.push({ role: 'system', content: `CHECKPOINT FAILED: ${missionState.checkpointBoard.analysis}\\n\\nPlease perform a targeted follow-up retrieval to resolve the gaps/conflicts.` });
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
            missionState.findingsBoard.forEach(f => fullFindings += `[${f.agent}]: ${f.content}\\n`);
            
            const synthMessages = [...thisHistory, { 
                role: "user", 
                content: `SYSTEM INSTRUCTION: You are the final Synthesist. Draft the final response to the user's original request using ONLY the verified data from the findings board:\\n${fullFindings}\\n\\nENSURE you preserve and include clickable markdown links [Title](url).`
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
\n\n"""
    
    content = content[:submit_start_idx] + new_logic + content[submit_end_idx:]
    with open(app_file, "w", encoding="utf-8") as f:
        f.write(content)
    print("Injected successfully!")
else:
    print("Could not find boundaries")
