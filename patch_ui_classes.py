import re

app_file = "d:/Github/hermes-frontend/app.js"
with open(app_file, "r", encoding="utf-8") as f:
    content = f.read()

# Find the start of updateTimelineUI and end of updateAgentPills
start_idx = content.find("function updateTimelineUI(state) {")
end_idx = content.find("function bindRunStoreUI(store) {")

if start_idx != -1 and end_idx != -1:
    new_logic = """function updateTimelineUI(state) {
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
        
        el.className = 'timeline-step';

        if (step === currentStepId) {
            el.classList.add('active');
            currentFound = true;
        } else if (currentFound) {
            el.classList.add('completed');
        } else {
            el.classList.add('pending');
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
            pillsHtml += `<span class="agent-pill streaming">Streaming...</span>`;
        }
        
        // Add status pill
        let statusText = 'Standing by';
        let statusClass = 'standing-by';
        
        if (state.status === 'planning_round_1') { statusText = 'Planning'; statusClass = 'planning'; }
        if (state.status === 'planning_round_2') { statusText = 'Committing'; statusClass = 'planning'; }
        if (state.status === 'retrieval') { statusText = 'Retrieving'; statusClass = 'retrieving'; }
        if (state.status === 'checkpoint' && agentKey === 'dgx_spark_2') { statusText = 'Evaluating'; statusClass = 'evaluating'; }
        if (state.status === 'synthesis' && agentKey === 'dgx_spark_2') { statusText = 'Synthesizing'; statusClass = 'synthesizing'; }

        pillsHtml += `<span class="agent-pill ${statusClass}">${statusText}</span>`;

        pillsContainer.innerHTML = pillsHtml;
    }
}

"""
    content = content[:start_idx] + new_logic + content[end_idx:]
    with open(app_file, "w", encoding="utf-8") as f:
        f.write(content)
    print("Updated app.js to use CSS classes.")
else:
    print("Could not find functions in app.js.")
