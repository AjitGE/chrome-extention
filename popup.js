let isRecording = false;
let recordedActions = [];
let settings = {
    captureHover: false,
    captureBlurFocus: false,
    darkMode: true
};

// Track pages and URLs globally
let pageMap = new Map();

// Track if we should generate code
let shouldGenerateCode = false;

// Add to state object at the top
let isAssertionMode = false;
 const page=`this.page`

document.addEventListener('DOMContentLoaded', function() {
    const recordButton = document.getElementById('recordButton');
    const themeToggle = document.getElementById('themeToggle');
    const actionsList = document.getElementById('actionsList');
    const codeOutput = document.getElementById('codeOutput');

    // Section-specific buttons
    const copyConstantsBtn = document.getElementById('copyConstantsBtn');
    const clearConstantsBtn = document.getElementById('clearConstantsBtn');
    const copyCodeBtn = document.getElementById('copyCodeBtn');
    const clearCodeBtn = document.getElementById('clearCodeBtn');

    // Initialize settings from storage
    chrome.storage.local.get(['isRecording', 'recordedActions', 'settings'], function(result) {
        isRecording = result.isRecording || false;
        recordedActions = result.recordedActions || [];
        settings = result.settings || {
            captureHover: false,
            captureBlurFocus: false,
            darkMode: true
        };

        // Update UI with stored settings
        if (document.getElementById('captureHoverToggle')) {
            document.getElementById('captureHoverToggle').checked = settings.captureHover;
        }

        // Apply dark mode by default
        document.documentElement.setAttribute('data-theme', settings.darkMode ? 'dark' : 'light');
        if (themeToggle) {
            themeToggle.innerHTML = settings.darkMode ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        }

        updateRecordButton();
        updateUI();
    });

    // Constants section handlers
    if (copyConstantsBtn) {
        copyConstantsBtn.addEventListener('click', function() {
            copyConstants();
        });
    }

    if (clearConstantsBtn) {
        clearConstantsBtn.addEventListener('click', function() {
            clearConstants();
        });
    }

    // Code section handlers
    if (copyCodeBtn) {
        copyCodeBtn.addEventListener('click', function() {
            copyPlaywrightCode();
        });
    }

    if (clearCodeBtn) {
        clearCodeBtn.addEventListener('click', function() {
            clearPlaywrightCode();
        });
    }

    function copyConstants() {
        const constants = actionsList?.querySelector('pre')?.textContent;
        if (constants && constants !== 'No constants recorded yet') {
            copyToClipboard(constants, copyConstantsBtn);
        }
    }

    function copyPlaywrightCode() {
        const code = codeOutput?.textContent;
        if (code && code !== 'No code generated yet') {
            copyToClipboard(code, copyCodeBtn);
        }
    }

    function clearConstants() {
        if (actionsList) {
            recordedActions = [];
            chrome.storage.local.set({ recordedActions: [] });
            actionsList.innerHTML = '<pre>No constants recorded yet</pre>';
            showFeedback(clearConstantsBtn);
        }
    }

    function clearPlaywrightCode() {
        if (codeOutput) {
            codeOutput.textContent = 'No code generated yet';
            showFeedback(clearCodeBtn);
        }
    }

    function copyToClipboard(text, button) {
        navigator.clipboard.writeText(text).then(() => {
            showFeedback(button, true);
        }).catch(err => {
            console.error('Failed to copy:', err);
            showError('Failed to copy to clipboard');
        });
    }

    function showFeedback(button, isCopy = false) {
        const icon = button.querySelector('i');
        if (icon) {
            const originalClass = icon.className;
            icon.className = isCopy ? 'fas fa-check' : 'fas fa-times';
            button.style.color = isCopy ? '#20c997' : '#dc3545';

            setTimeout(() => {
                icon.className = originalClass;
                button.style.color = '';
            }, 1000);
        }
    }

    // Record button handler
    if (recordButton) {
        recordButton.addEventListener('click', async function() {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab) {
                    showError('No active tab found');
                    return;
                }

                // If we're stopping the recording, don't check URL restrictions
                if (isRecording) {
                    isRecording = false;
                    await chrome.storage.local.set({ isRecording });
                    await chrome.runtime.sendMessage({
                        action: "toggleRecording",
                        isRecording: false,
                        tabId: tab.id
                    });
                    updateRecordButton();
                    return;
                }

                // Only check URL restrictions when starting recording
                if (tab.url.startsWith('chrome://') ||
                    tab.url.startsWith('chrome-extension://') ||
                    tab.url.startsWith('about:') ||
                    tab.url.startsWith('edge://')) {
                    showError('Cannot record on this page. Please try on a regular website.');
                    return;
                }

                // Start recording
                isRecording = true;
                try {
                    const response = await chrome.runtime.sendMessage({
                        action: "toggleRecording",
                        isRecording: true,
                        tabId: tab.id
                    });

                    if (response?.status === 'success') {
                        await chrome.storage.local.set({ isRecording });
                        recordedActions = [];
                        await chrome.storage.local.set({ recordedActions: [] });
                        updateUI();
                    } else {
                        isRecording = false;
                        const errorMessage = response?.message || 'Failed to start recording. Please try again.';
                        showError(errorMessage);
                    }
                } catch (error) {
                    isRecording = false;
                    showError('Failed to communicate with the extension. Please try again.');
                }
                updateRecordButton();

            } catch (error) {
                console.error('Error in click handler:', error);
                showError('An unexpected error occurred. Please try again.');
                isRecording = false;
                await chrome.storage.local.set({ isRecording: false });
                updateRecordButton();
            }
        });
    }

    // Theme toggle handler
    if (themeToggle) {
        themeToggle.addEventListener('click', function() {
            settings.darkMode = !settings.darkMode;
            if (settings.darkMode) {
                document.documentElement.setAttribute('data-theme', 'dark');
                themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
            } else {
                document.documentElement.setAttribute('data-theme', 'light');
                themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
            }
            chrome.storage.local.set({ settings });
        });
    }

    // Handle settings changes
    const captureHoverToggle = document.getElementById('captureHoverToggle');
    if (captureHoverToggle) {
        captureHoverToggle.addEventListener('change', function() {
            settings.captureHover = this.checked;
            settings.captureBlurFocus = this.checked;
            chrome.storage.local.set({ settings });

            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'updateSettings',
                        settings: settings
                    });
                }
            });
        });
    }

    // Listen for recorded actions
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.source === 'background' && message.type === 'actionRecorded' && message.action) {
            console.log('Received recorded action:', message.action);
            recordedActions.push(message.action);
            chrome.storage.local.set({ recordedActions });
            updateUI();
        }
        return false;
    });

    function updateRecordButton() {
        if (!recordButton) return;

        const recordIcon = recordButton.querySelector('i');
        const recordText = recordButton.querySelector('span');
        const recordingBadge = document.getElementById('recordingBadge');

        if (!recordIcon || !recordText) return;

        if (isRecording) {
            recordButton.classList.add('recording');
            recordIcon.className = 'fas fa-stop';
            recordText.textContent = 'Stop Recording';
            if (recordingBadge) {
                recordingBadge.classList.add('active');
            }
            chrome.runtime.sendMessage({
                action: "updateTitle",
                isRecording: true
            });
        } else {
            recordButton.classList.remove('recording');
            recordIcon.className = 'fas fa-circle';
            recordText.textContent = 'Start Recording';
            if (recordingBadge) {
                recordingBadge.classList.remove('active');
            }
            chrome.runtime.sendMessage({
                action: "updateTitle",
                isRecording: false
            });
        }
    }

    function updateUI() {
        if (!actionsList || !codeOutput) return;

        if (recordedActions.length === 0) {
            actionsList.innerHTML = '<pre>No constants recorded yet</pre>';
            codeOutput.textContent = 'No code generated yet';
        } else {
            console.log('Updating UI with recorded actions:', recordedActions);
            actionsList.innerHTML = '<pre>' + generateConstantsClass(recordedActions) + '</pre>';
            codeOutput.textContent = generatePlaywrightJavaCode(recordedActions);
        }
    }

    function showError(message) {
        console.error(message);
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;

        const existingError = document.querySelector('.error-message');
        if (existingError) {
            existingError.remove();
        }

        document.body.insertBefore(errorDiv, document.body.firstChild);

        setTimeout(() => {
            errorDiv.remove();
        }, 5000);
    }

    const captureAssertionToggle = document.getElementById('captureAssertionToggle');

    if (captureAssertionToggle) {
        captureAssertionToggle.addEventListener('change', function() {
            isAssertionMode = this.checked;

            // Send message to content script to toggle assertion mode
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'toggleAssertionMode',
                        isAssertionMode: isAssertionMode
                    });
                }
            });
        });
    }

    // ... rest of your existing code ...
});

function generateConstantsClass(actions) {
    if (actions.length === 0) return 'No constants generated yet';

    let code = ``;
    const constants = new Map();

    actions.forEach(action => {
        const info = action.elementInfo;
        if (!info) return;

        let constantName = '';
        let constantValue = '';

        switch (action.type) {
            case 'click':
                constantValue = info.text || info.name || info.label || 'unknown';
                constantName = constantValue
                    .toUpperCase()
                    .replace(/[^A-Z0-9]+/g, '_')
                    .replace(/(^_+|_+$)/g, '');
                break;
            case 'input':
                constantValue = info.placeholder || info.label || info.name || 'input field';
                constantName = constantValue
                    .toUpperCase()
                    .replace(/[^A-Z0-9]+/g, '_')
                    .replace(/(^_+|_+$)/g, '');
                break;
            case 'select':
                constantValue = info.label || info.name || 'dropdown';
                constantName = constantValue
                    .toUpperCase()
                    .replace(/[^A-Z0-9]+/g, '_')
                    .replace(/(^_+|_+$)/g, '');
                break;
        }

        if (constantName && constantValue) {
            // Handle duplicates by adding a number suffix
            let uniqueConstantName = constantName;
            let counter = 1;
            while (constants.has(uniqueConstantName)) {
                uniqueConstantName = `${constantName}_${counter}`;
                counter++;
            }
            constants.set(uniqueConstantName, {
                value: constantValue,
                type: action.type,
                pageInfo: action.pageInfo
            });
        }
    });

    // Generate constants
    for (const [name, details] of constants) {
        const { value, type, pageInfo } = details;
        const tabInfo = pageInfo ? ` in Tab ${pageInfo.pageNumber}` : '';
        code += `    // ${type.charAt(0).toUpperCase() + type.slice(1)} action${tabInfo}\n`;
        code += `    public static final String ${name} = "${value}";\n\n`;
    }

    code += `\n`;
    return code;
}

// Function to check if action should trigger code generation
function shouldTriggerCodeGeneration(action) {
    if (!action) return false;

    // Check for Enter key press
    if (action.type === 'keypress' && action.key === 'Enter') {
        return true;
    }

    // Check for button or submit click
    if (action.type === 'click' && action.element) {
        const tagName = action.element.tagName || '';
        const type = action.element.type || '';
        return tagName.toUpperCase() === 'BUTTON' || type === 'submit';
    }

    return false;
}

// Function to check if action is input type
function isInputAction(action) {
    if (!action?.type) return false;
    return action.type === 'search' || action.type === 'fill' || action.type === 'input';
}

// Modify the addAction function
function addAction(action) {
    if (!action) return;

    // Add action to recorded actions
    recordedActions.push(action);

    // Check if this is an input action
    if (isInputAction(action)) {
        shouldGenerateCode = true;
    }
    // Check if this is a trigger action (Enter key or button click)
    else if (shouldGenerateCode && shouldTriggerCodeGeneration(action)) {
        codeOutput.textContent = generatePlaywrightJavaCode(recordedActions);
        shouldGenerateCode = false; // Reset the flag
    }

    // Update the actions list
    updateActionsList();
}

// Add this function to generate camelCase variable names
function toCamelCase(str) {
    // Remove special characters and extra spaces
    str = str.replace(/[^a-zA-Z0-9 ]/g, ' ')
        .trim()
        .toLowerCase();

    // Convert to camelCase
    return str.split(' ')
        .map((word, index) =>
            index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
        )
        .join('');
}

// Update the generatePlaywrightJavaCode function
function generatePlaywrightJavaCode(actions) {
    if (!actions || actions.length === 0) return 'No recorded actions yet';

    let code = "";

    // Add variables section for input values
    const variables = new Set();
    actions.forEach(action => {
        if (action.type === 'input' && action.value) {
            const varName = toCamelCase(action.value);
            variables.add(`    private static final String ${varName} = "${action.value}";\n`);
        }
    });

    // Add variables to code if any exist
    if (variables.size > 0) {
        code += `    // Test data\n`;
        variables.forEach(variable => {
            code += variable;
        });
        code += '\n';
    }

    // Reset and rebuild pageMap for each code generation
    pageMap.clear();
    let currentTabNumber = null;

    // First pass: identify unique pages
    actions.forEach(action => {
        if (!action?.pageInfo) return;
        const pageNumber = action.pageInfo.pageNumber;
        const url = action.url;

        if (!pageMap.has(pageNumber)) {
            pageMap.set(pageNumber, {
                number: pageMap.size,
                url: url,
                domain: getDomainFromUrl(url)
            });
        }
    });

    // Generate action code
    actions.forEach(action => {
        if (!action?.elementInfo) return;

        const pageNumber = action.pageInfo?.pageNumber;
        const pageData = pageMap.get(pageNumber);
        const elementDesc = action.elementInfo.text ||
                          action.elementInfo.placeholder ||
                          action.elementInfo.label ||
                          'element';
        // Declare variables outside switch
        const varName = action.type === 'input' ? toCamelCase(action.value) : '';

        // Break down nested ternary into clearer logic
        let files = null;
        if (action.type === 'fileUpload') {
            files = Array.isArray(action.value) ? action.value : [action.value];
        }

        // Add navigation if it's a new page
        if (pageData && currentTabNumber !== pageNumber) {
            code += `        // Recording on ${pageNumber}: with url  ${pageData.url}\n`;
            currentTabNumber = pageNumber;
        }

        // Generate code based on action type
        switch (action.type) {
            case 'click':
                code += `        logger.info(LogBuilder.getLogLine("Click on ${elementDesc}"));\n`;
                code += `        ${page}.${generateSelector(action.elementInfo)}.click();\n\n`;
                break;

            case 'input':
                code += `        logger.info(LogBuilder.getLogLine("Fill input ${elementDesc} with ${varName}"));\n`;
                code += `        ${page}.${generateSelector(action.elementInfo)}.click();\n`;
                code += `        ${page}.${generateSelector(action.elementInfo)}.fill(${varName});\n\n`;
                break;

            case 'select':
                code += `        logger.info(LogBuilder.getLogLine("Select option '${action.value}' from ${elementDesc}"));\n`;
                code += `        ${page}.${generateSelector(action.elementInfo)}.selectOption("${action.value}");\n\n`;
                break;

            case 'hover':
                code += `        logger.info(LogBuilder.getLogLine("Hover over ${elementDesc}"));\n`;
                code += `        ${page}.${generateSelector(action.elementInfo)}.hover();\n\n`;
                break;

            case 'rightClick':
                code += `        logger.info(LogBuilder.getLogLine("Right click on ${elementDesc}"));\n`;
                code += `        ${page}.${generateSelector(action.elementInfo)}.click(new ClickOptions().setButton(MouseButton.RIGHT));\n\n`;
                break;

            case 'doubleClick':
                code += `        logger.info(LogBuilder.getLogLine("Double click on ${elementDesc}"));\n`;
                code += `        ${page}.${generateSelector(action.elementInfo)}.dblclick();\n\n`;
                break;

            case 'fileUpload':
                code += `        logger.info(LogBuilder.getLogLine("Upload files to ${elementDesc}"));\n`;
                code += `        ${page}.${generateSelector(action.elementInfo)}.setInputFiles(new String[] {"${files.join('", "')}"});\n\n`;
                break;

            case 'check':
                code += `        logger.info(LogBuilder.getLogLine("Check ${elementDesc}"));\n`;
                code += `        ${page}.${generateSelector(action.elementInfo)}.check();\n\n`;
                break;

            case 'uncheck':
                code += `        logger.info(LogBuilder.getLogLine("Uncheck ${elementDesc}"));\n`;
                code += `        ${page}.${generateSelector(action.elementInfo)}.uncheck();\n\n`;
                break;

            case 'focus':
                code += `        logger.info(LogBuilder.getLogLine("Focus on ${elementDesc}"));\n`;
                code += `        ${page}.${generateSelector(action.elementInfo)}.focus();\n\n`;
                break;

            case 'blur':
                code += `        logger.info(LogBuilder.getLogLine("Remove focus from ${elementDesc}"));\n`;
                code += `        ${page}.${generateSelector(action.elementInfo)}.evaluate(element => element.blur());\n\n`;
                break;

            case 'keyPress':
                code += `        logger.info(LogBuilder.getLogLine("Press key: ${action.value}"));\n`;
                code += `        ${page}.keyboard().press("${action.value}");\n\n`;
                break;

            case 'assertion':
                code += `        logger.info(LogBuilder.getLogLine("Assert ${elementDesc} is visible"));\n`;
                code += `        assertThat(${page}.${generateSelector(action.elementInfo)}.isVisible()).isTrue();\n\n`;
                break;

            case 'dragDrop':
                if (action.targetInfo) {
                    code += `        logger.info(LogBuilder.getLogLine("Drag and drop ${elementDesc}"));\n`;
                    code += `        ${page}.${generateSelector(action.elementInfo)}.dragTo(${page}.${generateSelector(action.targetInfo)});\n\n`;
                }
                break;
        }
    });

    code += `    \n\n`;
    return code;
}

// Helper function to generate selector from element info
function generateSelector(elementInfo) {
    if (!elementInfo) return '';

    // Try role-based selector first
    if (elementInfo.role && elementInfo.label) {
        return `getByRole(AriaRole.${elementInfo.role.toUpperCase()}, new GetByRoleOptions().setName("${elementInfo.label}"))`;
    }

    // Try label-based selector
    if (elementInfo.label) {
        return `getByLabel("${elementInfo.label}")`;
    }

    // Try placeholder-based selector
    if (elementInfo.placeholder) {
        return `getByPlaceholder("${elementInfo.placeholder}")`;
    }

    // Try text-based selector
    if (elementInfo.text) {
        return `getByText("${elementInfo.text}")`;
    }

    // Try test ID selector
    if (elementInfo.testId) {
        return `getByTestId("${elementInfo.testId}")`;
    }

    // Fallback to CSS locator for other cases
    if (elementInfo.id) {
        return `locator("#${elementInfo.id}")`;
    }

    if (elementInfo.type && elementInfo.tagName) {
        return `locator("${elementInfo.tagName.toLowerCase()}[type='${elementInfo.type}']")`;
    }

    return `locator("${elementInfo.tagName?.toLowerCase() || '*'}")`;
}

// Update generateInputSelector to use modern locators
function generateInputSelector(elementInfo) {

    if (elementInfo.tagName !== 'INPUT' && elementInfo.tagName !== 'TEXTAREA') return null;

    // Try label first for form controls
    if (elementInfo.label) {
        return `${page}.getByLabel("${elementInfo.label}")`;
    }

    // Try placeholder for input fields
    if (elementInfo.placeholder) {
        return `${page}.getByPlaceholder("${elementInfo.placeholder}")`;
    }

    // Try role with name
    if (elementInfo.role) {
        const options = elementInfo.label ?
            `, new Page.GetByRoleOptions().setName("${elementInfo.label}")` : '';
        return `${page}.getByRole(AriaRole.${elementInfo.role.toUpperCase()}${options})`;
    }

    // Fallback to other selectors
    if (elementInfo.testId) {
        return `${page}.getByTestId("${elementInfo.testId}")`;
    }

    return null;
}

function getDomainFromUrl(url) {
    if (!url) return null;
    try {
        const urlObj = new URL(url);
        if (!urlObj.hostname || urlObj.protocol === 'chrome:') return null;
        return urlObj.hostname;
    } catch (e) {
        return null;
    }
}
