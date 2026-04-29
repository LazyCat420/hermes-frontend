import re
import os

app_file = "d:/Github/hermes-frontend/app.js"
with open(app_file, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Remove from renderHistory
render_partial_pattern = r"if \(mState && mState\.status === \"synthesis\".*?container\);\n    \}"
content = re.sub(render_partial_pattern, "", content, flags=re.DOTALL)

# 2. Remove from restoreStoryboard - planning round 1
plan1_partial_pattern = r"if \(state\.partialStreams\) \{\n\s*Object\.entries\(state\.partialStreams\)\.forEach\(\(\[agentKey, chunk\]\) => \{\n\s*if \(\!state\.planningBoard\.round1Proposals\[agentKey\]\) \{\n\s*const agentName = AGENTS\[agentKey\]\?\.name \|\| agentKey;\n\s*const div = document\.createElement\('div'\);\n\s*div\.className = 'agent-contribution';\n\s*div\.innerHTML = `<div class=\"agent-role\">\$\{agentName\}</div><div class=\"agent-text\">\$\{marked\.parse\(chunk \|\| ''\)\}<div class=\"typing-indicator\"><span></span><span></span><span></span></div></div>`;\n\s*planContent\.appendChild\(div\);\n\s*\}\n\s*\}\);\n\s*\}"
content = re.sub(plan1_partial_pattern, "", content, flags=re.DOTALL)

# 3. Remove from restoreStoryboard - planning round 2
plan2_partial_pattern = r"if \(state\.status === \"planning_round_2\" && state\.partialStreams\) \{\n\s*Object\.entries\(state\.partialStreams\)\.forEach\(\(\[agentKey, chunk\]\) => \{\n\s*if \(\!state\.planningBoard\.finalAssignments\[agentKey\]\) \{\n\s*const agentName = AGENTS\[agentKey\]\?\.name \|\| agentKey;\n\s*const div = document\.createElement\('div'\);\n\s*div\.className = 'agent-contribution';\n\s*div\.innerHTML = `<div class=\"agent-role\">\$\{agentName\}</div><div class=\"agent-text\">\$\{marked\.parse\(chunk \|\| ''\)\}<div class=\"typing-indicator\"><span></span><span></span><span></span></div></div>`;\n\s*planContent\.appendChild\(div\);\n\s*\}\n\s*\}\);\n\s*\}"
content = re.sub(plan2_partial_pattern, "", content, flags=re.DOTALL)

# 4. Remove from restoreStoryboard - findings
findings_partial_pattern = r"if \(state\.status === \"retrieval\" && state\.partialStreams\) \{\n\s*Object\.entries\(state\.partialStreams\)\.forEach\(\(\[agentName, chunk\]\) => \{\n\s*if \(\!state\.findingsBoard\.find\(f => f\.agent === agentName\)\) \{\n\s*const cardDiv = document\.createElement\('div'\);\n\s*cardDiv\.className = 'finding-card';\n\s*cardDiv\.innerHTML = `<div class=\"finding-source\">\$\{agentName\}</div><div class=\"finding-text\">\$\{marked\.parse\(chunk \|\| ''\)\}<div class=\"typing-indicator\"><span></span><span></span><span></span></div></div>`;\n\s*findingsContent\.appendChild\(cardDiv\);\n\s*\}\n\s*\}\);\n\s*\}"
content = re.sub(findings_partial_pattern, "", content, flags=re.DOTALL)

# 5. Remove from restoreStoryboard - checkpoint
cp_partial_pattern = r"\} else if \(state\.status === \"checkpoint\" && state\.partialStreams && state\.partialStreams\['evaluator'\]\) \{\n\s*const cpDiv = document\.createElement\('div'\);\n\s*cpDiv\.className = 'agent-contribution';\n\s*cpDiv\.innerHTML = `<div class=\"agent-role\">Evaluator</div><div class=\"agent-text\">\$\{marked\.parse\(state\.partialStreams\['evaluator'\]\)\}<div class=\"typing-indicator\"><span></span><span></span><span></span></div></div>`;\n\s*cpContent\.appendChild\(cpDiv\);\n\s*\}"
content = re.sub(cp_partial_pattern, "}", content, flags=re.DOTALL)

with open(app_file, "w", encoding="utf-8") as f:
    f.write(content)

print("Removed partial stream rendering logic.")
