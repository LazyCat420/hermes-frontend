// test_app_error_handling.js

// Mock the return value of streamChat when the proxy times out or throws an error
const mockErrorResult = {
    type: 'error',
    error: 'HTTP error! status: 504'
    // Notice `content` is undefined
};

// Original bug implementation:
function simulateOriginalPlanningPhase(result) {
    console.log("Running original implementation...");
    let parsedTasks = [];
    try {
        const match = result.content.match(/TASKS:\s*(.+)/);
        if (match) {
            parsedTasks = match[1].split('|').map(t => t.trim()).filter(t => t.length > 0);
        }
        console.log("Original parsedTasks:", parsedTasks);
    } catch (e) {
        console.error("Original Implementation Crashed!");
        throw e;
    }
}

// Fixed implementation:
function simulateFixedPlanningPhase(result) {
    console.log("Running fixed implementation...");
    let parsedTasks = [];
    try {
        const match = (result.content || "").match(/TASKS:\s*(.+)/);
        if (match) {
            parsedTasks = match[1].split('|').map(t => t.trim()).filter(t => t.length > 0);
        }
        if (parsedTasks.length === 0) {
            parsedTasks = ["Execute general retrieval based on the plan"];
        }
        console.log("Fixed parsedTasks:", parsedTasks);
        console.log("Success! No crash.");
    } catch (e) {
        console.error("Fixed Implementation Crashed!", e);
        throw e;
    }
}

async function runTests() {
    console.log("--- TDD Error Handling Tests ---");
    
    let originalFailed = false;
    try {
        simulateOriginalPlanningPhase(mockErrorResult);
    } catch (e) {
        if (e.message.includes("Cannot read properties of undefined (reading 'match')")) {
            originalFailed = true;
            console.log("✅ Expected crash confirmed in original implementation.");
        } else {
            console.error("Unexpected error:", e);
        }
    }

    if (!originalFailed) {
        console.error("❌ Original implementation did not crash as expected!");
        process.exit(1);
    }

    console.log("\n----------------------------------\n");

    try {
        simulateFixedPlanningPhase(mockErrorResult);
        console.log("✅ Fixed implementation handled the undefined content perfectly.");
    } catch (e) {
        console.error("❌ Fixed implementation crashed!");
        process.exit(1);
    }
}

runTests();
