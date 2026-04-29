import re

app_file = "d:/Github/hermes-frontend/app.js"
with open(app_file, "r", encoding="utf-8") as f:
    content = f.read()

# Insert the UI updating functions after MarkdownThrottler class
binder_code = """
function updateTimelineUI(state) {
    const timeline = document.getElementById('mission-timeline');
    if (!timeline) return;
    
    // Only show if we are in a mission
    if (state.status) {
        timeline.style.display = 'flex';
    } else {
        timeline.style.display = 'none';
        return;
    }

    const steps = ['start', 'plan1', 'plan2', 'retrieval', 'checkpoint', 'synthesis'];
    let currentFound = false;

    // Map state.status to steps
    const statusMap = {
        'planning_round_1': 'plan1',
        'planning_round_2': 'plan2',
        'retrieval': 'retrieval',
        'checkpoint': 'checkpoint',
        'synthesis': 'synthesis',
        'complete': 'synthesis'
    };
    const currentStepId = statusMap[state.status] || 'start';

    // Reverse iterate to find active
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        const el = document.getElementById('timeline-' + step);
        if (!el) continue;

        if (step === currentStepId) {
            el.style.color = '#00e5ff';
            el.style.textShadow = '0 0 8px rgba(0,229,255,0.6)';
            currentFound = true;
        } else if (currentFound) {
            el.style.color = '#10b981';
            el.style.textShadow = 'none';
        } else {
            el.style.color = '#64748b';
            el.style.textShadow = 'none';
        }
    }
}

function updateAgentPills(state) {
    const activeAgents = Object.keys(AGENTS);
    for (const agentKey of activeAgents) {
        const pillsContainer = document.getElementById('pills-' + AGENTS[agentKey].id);
        if (!pillsContainer) continue;
        
        let pillsHtml = '';

        // Add tool pill if streaming
        if (state.partialStreams[agentKey]) {
            pillsHtml += `<span style="background: rgba(0, 229, 255, 0.2); color: #00e5ff; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; border: 1px solid #00e5ff;">Streaming...</span>`;
        }
        
        // Add status pill
        let statusText = 'Standing by';
        let statusColor = '#64748b';
        if (state.status === 'planning_round_1') { statusText = 'Planning'; statusColor = '#f59e0b'; }
        if (state.status === 'planning_round_2') { statusText = 'Committing'; statusColor = '#f59e0b'; }
        if (state.status === 'retrieval') { statusText = 'Retrieving'; statusColor = '#3b82f6'; }
        if (state.status === 'checkpoint' && agentKey === 'dgx_spark_2') { statusText = 'Evaluating'; statusColor = '#8b5cf6'; }
        if (state.status === 'synthesis' && agentKey === 'dgx_spark_2') { statusText = 'Synthesizing'; statusColor = '#10b981'; }

        pillsHtml += `<span style="background: rgba(255, 255, 255, 0.1); color: ${statusColor}; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; border: 1px solid ${statusColor};">${statusText}</span>`;

        pillsContainer.innerHTML = pillsHtml;
    }
}

function bindRunStoreUI(store) {
    store.on('*', (ev, self) => {
        const state = self.getState();
        updateTimelineUI(state);
        updateAgentPills(state);
    });
    const state = store.getState();
    updateTimelineUI(state);
    updateAgentPills(state);
}

// UI Elements"""

content = content.replace("// UI Elements", binder_code)

# Now, attach bindRunStoreUI after runStore creation.
content = re.sub(r'(let runStore = new RunStore\([^)]+\);)', r'\1\n    bindRunStoreUI(runStore);', content)
content = re.sub(r'(const store = new RunStore\([^)]+\);)', r'\1\n        bindRunStoreUI(store);', content)

with open(app_file, "w", encoding="utf-8") as f:
    f.write(content)

print("Applied Timeline and Agent Pill logic to app.js")
