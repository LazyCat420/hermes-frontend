import re

app_file = "d:/Github/hermes-frontend/app.js"
with open(app_file, "r", encoding="utf-8") as f:
    content = f.read()

start_idx = content.find("async function executeMission(thisSessionId, thisHistory, runStore, activeAgents, text, thisContainer) {")
if start_idx == -1:
    print("Could not find start index")
    exit(1)

end_idx = content.find("function setAgentStatus")
if end_idx == -1:
    print("Could not find end index")
    exit(1)

new_logic = """async function executeMission(thisSessionId, thisHistory, runStore, activeAgents, text, thisContainer) {
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
        let state = runStore.getState();

        if (state.status === "planning_round_1") {
            planningStatus.innerText = "Round 1 (Proposals)";
            const round1Promises = activeAgents.map(async (agentKey) => {
                state = runStore.getState();
                if (state.planningBoard.round1Proposals[agentKey]) {
                    return { agentKey, name: AGENTS[agentKey].name, content: state.planningBoard.round1Proposals[agentKey] };
                }

                const agentName = AGENTS[agentKey].name;
                const prompt = `MISSION: "${text}". Propose a soft role (Scout, Analyst, or Synthesist) and a 1-sentence strategy for what you will investigate. DO NOT execute tools yet.`;
                
                const agentDiv = document.createElement('div');
                agentDiv.className = 'agent-contribution';
                agentDiv.innerHTML = `<div class="agent-role">${agentName}</div><div class="agent-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
                planningContent.appendChild(agentDiv);
                const textDiv = agentDiv.querySelector('.agent-text');
                const throttler = new MarkdownThrottler(textDiv, thisContainer);
                
                const result = await streamChat(agentKey, [...thisHistory, { role: 'user', content: prompt }], (chunk) => {
                    throttler.update(chunk);
                    runStore.emit('stream.delta', { agentKey: agentKey, chunk: chunk });
                    throttledSaveSession(thisSessionId, thisHistory, runStore);
                }, thisContainer);
                
                throttler.flush();
                runStore.emit('stream.end', { agentKey: agentKey });
                runStore.emit('agent.plan.round1', { agentKey: agentKey, content: result.content });
                saveSession(thisSessionId, thisHistory, runStore);
                return { agentKey, name: agentName, content: result.content };
            });
            
            await Promise.all(round1Promises);
            runStore.emit('phase.transition', { status: 'planning_round_2' });
            saveSession(thisSessionId, thisHistory, runStore);
        }

        state = runStore.getState();
        if (state.status === "planning_round_2") {
            planningStatus.innerText = "Round 2 (Commitment)";
            
            let round1Context = "ROUND 1 PROPOSALS:\\n";
            Object.entries(state.planningBoard.round1Proposals).forEach(([ak, content]) => {
                round1Context += `- ${AGENTS[ak]?.name || ak}: ${content}\\n`;
            });
            
            for (const agentKey of activeAgents) {
                state = runStore.getState();
                if (state.planningBoard.finalAssignments[agentKey]) continue;

                const agentName = AGENTS[agentKey].name;
                const prompt = `MISSION: "${text}".\\n\\n${round1Context}\\n\\nBased on the team's proposals, lock in your final role and specific task assignment. If someone else took your target, PIVOT to a new non-overlapping target. Output your final 1-sentence commitment.`;
                
                const agentDiv = document.createElement('div');
                agentDiv.className = 'agent-contribution';
                agentDiv.innerHTML = `<div class="agent-role">${agentName}</div><div class="agent-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
                planningContent.appendChild(agentDiv);
                const textDiv = agentDiv.querySelector('.agent-text');
                const throttler = new MarkdownThrottler(textDiv, thisContainer);
                
                const result = await streamChat(agentKey, [...thisHistory, { role: 'user', content: prompt }], (chunk) => {
                    throttler.update(chunk);
                    runStore.emit('stream.delta', { agentKey: agentKey, chunk: chunk });
                    throttledSaveSession(thisSessionId, thisHistory, runStore);
                }, thisContainer);
                
                throttler.flush();
                runStore.emit('stream.end', { agentKey: agentKey });
                runStore.emit('agent.plan.round2', { agentKey: agentKey, content: result.content });
                saveSession(thisSessionId, thisHistory, runStore);
            }
            
            planningStatus.innerText = "Locked";
            planningStatus.style.animation = "none";
            planningStatus.style.color = "#10b981";
            
            runStore.emit('phase.transition', { status: 'retrieval' });
            saveSession(thisSessionId, thisHistory, runStore);
            state = runStore.getState();
            
            let teamPlanContext = "TEAM PLAN LOCK:\\n";
            activeAgents.forEach(k => teamPlanContext += `- ${AGENTS[k]?.name || k}: ${state.planningBoard.finalAssignments[k]}\\n`);
            thisHistory.push({ role: 'system', content: teamPlanContext });
        }

        state = runStore.getState();
        if (state.status === "retrieval") {
            findingsBoard.style.display = 'flex';
            
            if (!thisHistory.find(h => h.role === 'system' && h.content && h.content.startsWith("TEAM PLAN LOCK"))) {
                let teamPlanContext = "TEAM PLAN LOCK:\\n";
                activeAgents.forEach(k => teamPlanContext += `- ${AGENTS[k]?.name || k}: ${state.planningBoard.finalAssignments[k]}\\n`);
                thisHistory.push({ role: 'system', content: teamPlanContext });
            }

            const retrievalPromises = [];
            const TARGET_CONCURRENCY = 6;
            const subagentsPerBox = Math.ceil(TARGET_CONCURRENCY / activeAgents.length);
            
            for (const agentKey of activeAgents) {
                for (let i = 1; i <= subagentsPerBox; i++) {
                    const agentName = AGENTS[agentKey].name;
                    const subAgentName = `${agentName} (Thread ${i})`;
                    
                    state = runStore.getState();
                    if (state.findingsBoard.find(f => f.agent === subAgentName)) {
                        retrievalPromises.push(Promise.resolve({ 
                            agent: subAgentName, 
                            result: state.findingsBoard.find(f => f.agent === subAgentName).content, 
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
                    const throttler = new MarkdownThrottler(textDiv, thisContainer);
                    
                    const p = streamChat(agentKey, [...thisHistory, { role: 'user', content: prompt }], (chunk) => {
                        throttler.update(chunk);
                        runStore.emit('stream.delta', { agentKey: subAgentName, chunk: chunk });
                        throttledSaveSession(thisSessionId, thisHistory, runStore);
                    }, thisContainer).then(result => {
                        throttler.flush();
                        runStore.emit('stream.end', { agentKey: subAgentName });
                        runStore.emit('agent.finding', { agent: subAgentName, content: result.content || result.error });
                        saveSession(thisSessionId, thisHistory, runStore);
                        return { agent: subAgentName, result: result.content, error: result.error };
                    });
                    
                    retrievalPromises.push(p);
                }
            }
            
            await Promise.all(retrievalPromises);
            findingsBoard.querySelector('.board-status').innerText = "Complete";
            findingsBoard.querySelector('.board-status').style.animation = "none";
            findingsBoard.querySelector('.board-status').style.color = "#10b981";
            
            runStore.emit('phase.transition', { status: 'checkpoint' });
            saveSession(thisSessionId, thisHistory, runStore);
        }

        state = runStore.getState();
        if (state.status === "checkpoint") {
            checkpointBoard.style.display = 'flex';
            
            if (!thisHistory.find(h => h.role === 'system' && h.content && h.content.startsWith("EVIDENCE FOUND"))) {
                let findingsContext = "EVIDENCE FOUND:\\n";
                state.findingsBoard.forEach(f => {
                    if (!f.agent.includes('(Follow-up)')) {
                        findingsContext += `[${f.agent}]: ${f.content}\\n`;
                    }
                });
                thisHistory.push({ role: 'system', content: findingsContext });
            }

            const evaluatorKey = activeAgents.includes('dgx_spark_2') ? 'dgx_spark_2' : activeAgents[0];
            const evaluatorName = AGENTS[evaluatorKey].name;

            if (!state.checkpointBoard.analysis) {
                const cpDiv = document.createElement('div');
                cpDiv.className = 'agent-contribution';
                cpDiv.innerHTML = `<div class="agent-role">${evaluatorName} (Evaluator)</div><div class="agent-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
                checkpointContent.appendChild(cpDiv);
                const cpTextDiv = cpDiv.querySelector('.agent-text');
                const throttler = new MarkdownThrottler(cpTextDiv, thisContainer);
                
                const cpPrompt = `Review the EVIDENCE FOUND. Identify: 1. Conflicting claims. 2. Missing evidence required to fully answer the user's request. Output CONSENSUS: TRUE if we have enough verified data to proceed to final synthesis. Output CONSENSUS: FALSE and list the missing evidence if we need another retrieval pass.`;
                
                const cpResult = await streamChat(evaluatorKey, [...thisHistory, { role: 'user', content: cpPrompt }], (chunk) => {
                    throttler.update(chunk);
                    runStore.emit('stream.delta', { agentKey: 'evaluator', chunk: chunk });
                    throttledSaveSession(thisSessionId, thisHistory, runStore);
                }, thisContainer);
                
                throttler.flush();
                const cpContent = cpResult.content || "";
                runStore.emit('stream.end', { agentKey: 'evaluator' });
                runStore.emit('checkpoint.analysis', { content: cpContent, conflictTriggered: cpContent.includes('CONSENSUS: FALSE') });
                saveSession(thisSessionId, thisHistory, runStore);
                
                state = runStore.getState();
                
                if (cpContent.includes('CONSENSUS: FALSE')) {
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
                        
                        const textDiv = cardDiv.querySelector('.finding-text');
                        const followupThrottler = new MarkdownThrottler(textDiv, thisContainer);

                        const result = await streamChat(agentKey, [...thisHistory, { role: 'user', content: 'Execute follow-up retrieval to resolve the checkpoint gaps.' }], (chunk) => {
                            followupThrottler.update(chunk);
                            runStore.emit('stream.delta', { agentKey: agentName + ' (Follow-up)', chunk: chunk });
                            throttledSaveSession(thisSessionId, thisHistory, runStore);
                        }, thisContainer);
                        
                        followupThrottler.flush();
                        runStore.emit('stream.end', { agentKey: agentName + ' (Follow-up)' });
                        runStore.emit('agent.finding', { agent: agentName + ' (Follow-up)', content: result.content });
                        saveSession(thisSessionId, thisHistory, runStore);
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
                if (state.conflictResolutionTriggered) {
                    const followups = state.findingsBoard.filter(f => f.agent.includes('(Follow-up)'));
                    if (followups.length < activeAgents.length) {
                        if (!thisHistory.find(h => h.role === 'system' && h.content && h.content.startsWith("CHECKPOINT FAILED"))) {
                            thisHistory.push({ role: 'system', content: `CHECKPOINT FAILED: ${state.checkpointBoard.analysis}\\n\\nPlease perform a targeted follow-up retrieval to resolve the gaps/conflicts.` });
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
                            
                            const textDiv = cardDiv.querySelector('.finding-text');
                            const followupThrottler = new MarkdownThrottler(textDiv, thisContainer);

                            const result = await streamChat(agentKey, [...thisHistory, { role: 'user', content: 'Execute follow-up retrieval to resolve the checkpoint gaps.' }], (chunk) => {
                                followupThrottler.update(chunk);
                                runStore.emit('stream.delta', { agentKey: agentName + ' (Follow-up)', chunk: chunk });
                                throttledSaveSession(thisSessionId, thisHistory, runStore);
                            }, thisContainer);
                            
                            followupThrottler.flush();
                            runStore.emit('stream.end', { agentKey: agentName + ' (Follow-up)' });
                            runStore.emit('agent.finding', { agent: agentName + ' (Follow-up)', content: result.content });
                            saveSession(thisSessionId, thisHistory, runStore);
                            return result.content;
                        });
                        await Promise.all(followUpPromises);
                    }
                }
            }
            
            checkpointBoard.querySelector('.board-status').innerText = "Locked";
            checkpointBoard.querySelector('.board-status').style.animation = "none";
            checkpointBoard.querySelector('.board-status').style.color = "#10b981";
            
            runStore.emit('phase.transition', { status: 'synthesis' });
            saveSession(thisSessionId, thisHistory, runStore);
        }

        state = runStore.getState();
        if (state.status === "synthesis") {
            const synthStart = performance.now();
            const finalContentDiv = appendMessage('assistant', '<div class="typing-indicator"><span></span><span></span><span></span></div>', 'Hermes Orchestrator (Synthesis)', false, thisContainer);
            const synthThrottler = new MarkdownThrottler(finalContentDiv, thisContainer);
            
            let fullFindings = "";
            state.findingsBoard.forEach(f => fullFindings += `[${f.agent}]: ${f.content}\\n`);
            
            const synthMessages = [...thisHistory, { 
                role: "user", 
                content: `SYSTEM INSTRUCTION: You are the final Synthesist. Draft the final response to the user's original request using ONLY the verified data from the findings board:\\n${fullFindings}\\n\\nENSURE you preserve and include clickable markdown links [Title](url).`
            }];
            
            const evaluatorKey = activeAgents.includes('dgx_spark_2') ? 'dgx_spark_2' : activeAgents[0];

            const finalResult = await streamChat(evaluatorKey, synthMessages, (chunk) => {
                synthThrottler.update(chunk);
                runStore.emit('stream.delta', { agentKey: 'synthesis', chunk: chunk });
                throttledSaveSession(thisSessionId, thisHistory, runStore);
            }, thisContainer);
            
            synthThrottler.flush();
            const latency_ms = performance.now() - synthStart;
            const token_count = Math.round((finalResult.content || '').length / 4);
            
            thisHistory.push({ role: "assistant", content: finalResult.content });
            runStore.emit('stream.end', { agentKey: 'synthesis' });
            runStore.emit('phase.transition', { status: 'complete' });
            
            saveSession(thisSessionId, thisHistory, runStore);
            if (currentSessionId === thisSessionId) {
                globalHistory = [...thisHistory];
                globalMissionStates[thisSessionId] = runStore;
            }
            
            state = runStore.getState();
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
                    collaboration_rounds: state.checkpointRounds || 1,
                    conflict_resolution: state.conflictResolutionTriggered || false
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
"""
content = content[:start_idx] + new_logic + content[end_idx:]

# Also update `orchestrate` function
orch_start_idx = content.find("async function orchestrate(agentKey, messages) {")
if orch_start_idx != -1:
    orch_end_idx = content.find("}", content.find("return result.content;", orch_start_idx)) + 1
    new_orch = """async function orchestrate(agentKey, messages) {
    const agentName = AGENTS[agentKey].name;
    const container = sessionDOMs[currentSessionId];
    const contentDiv = appendMessage('agent', '<div class="typing-indicator"><span></span><span></span><span></span></div>', agentName, false, container);
    const throttler = new MarkdownThrottler(contentDiv, container);
    
    const result = await streamChat(agentKey, messages, (text) => {
        throttler.update(text);
    });

    throttler.flush();
    if (result.type === 'error') {
        contentDiv.innerHTML = `<span style="color: #ef4444;">Error: ${result.error}</span>`;
        return "";
    }

    if (result.type === 'text') {
        return result.content;
    }
}"""
    content = content[:orch_start_idx] + new_orch + content[orch_end_idx:]

with open(app_file, "w", encoding="utf-8") as f:
    f.write(content)
print("Updated executeMission with MarkdownThrottler usages.")
