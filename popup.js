let isRecording = false;
let recordedActions = [];
let settings = {
    captureHover: false,
    darkMode: false
};

// Track pages and URLs globally
let pageMap = new Map();

// Track if we should generate code
let shouldGenerateCode = false;

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
        settings = result.settings || { captureHover: false, darkMode: false };

        // Update UI with stored settings
        if (document.getElementById('captureHoverToggle')) {
            document.getElementById('captureHoverToggle').checked = settings.captureHover;
        }

        // Apply dark mode if enabled
        if (settings.darkMode) {
            document.documentElement.setAttribute('data-theme', 'dark');
            if (themeToggle) {
                themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
            }
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            if (themeToggle) {
                themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
            }
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
            icon.className = isCopy ? 'fas fa-check' : 'fas fa-check';
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

                if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
                    showError('Cannot record on this page. Please try on a regular website.');
                    return;
                }

                isRecording = !isRecording;

                try {
                    const response = await new Promise((resolve) => {
                        chrome.runtime.sendMessage({
                            action: "toggleRecording",
                            isRecording: isRecording,
                            tabId: tab.id
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.error('Runtime error:', chrome.runtime.lastError);
                                resolve({ status: 'error', message: chrome.runtime.lastError.message });
                            } else {
                                resolve(response);
                            }
                        });
                    });

                    if (response && response.status === 'success') {
                        await chrome.storage.local.set({ isRecording });

                        if (isRecording) {
                            recordedActions = [];
                            await chrome.storage.local.set({ recordedActions: [] });
                            updateUI();
                        }
                    } else {
                        isRecording = !isRecording;
                        const errorMessage = response?.message || 'Failed to toggle recording. Please try again.';
                        showError(errorMessage);
                    }
                } catch (error) {
                    console.error('Error sending message:', error);
                    isRecording = !isRecording;
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
        captureHoverToggle.addEventListener('change', function(e) {
            settings.captureHover = e.target.checked;
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

    // ... rest of your existing code ...
});

function generateConstantsClass(actions) {
    if (actions.length === 0) return 'No constants generated yet';

    let code = `public class PageConstants {\n`;
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
                    .replace(/^_+|_+$/g, '');
                break;
            case 'input':
                constantValue = info.placeholder || info.label || info.name || 'input field';
                constantName = constantValue
                    .toUpperCase()
                    .replace(/[^A-Z0-9]+/g, '_')
                    .replace(/^_+|_+$/g, '');
                break;
            case 'select':
                constantValue = info.label || info.name || 'dropdown';
                constantName = constantValue
                    .toUpperCase()
                    .replace(/[^A-Z0-9]+/g, '_')
                    .replace(/^_+|_+$/g, '');
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

    code += `}\n`;
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
    if (!action || !action.type) return false;
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
function generatePlaywrightJavaCode(actions) {
    if (!actions || actions.length === 0) return '';

    let code = `import com.microsoft.playwright.*;\n`;
    code += `import org.junit.jupiter.api.*;\n\n`;
    code += `public class RecordedTest {\n`;
    code += `    private PageController pageController;\n\n`;

    // Reset and rebuild pageMap for each code generation
    pageMap.clear();
    let currentTabNumber = null;

    // First pass: identify unique pages
    actions.forEach(action => {
        if (!action || !action.pageInfo) return;

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

    // Generate page creation code
    for (const [pageNumber, pageData] of pageMap) {
        code += `        // Navigate to page ${pageNumber}${pageData.domain ? ` (${pageData.domain})` : ''}\n`;
        code += `        this.pageController.getPage().navigate("${pageData.url}");\n\n`;
    }

    // Generate action code
    actions.forEach(action => {
        if (!action || !action.pageInfo || !action.elementInfo) return;

        const pageNumber = action.pageInfo.pageNumber;
        const pageData = pageMap.get(pageNumber);
        if (!pageData) return;

        // Add tab switch comment if we're changing tabs
        if (currentTabNumber !== pageNumber) {
            const domain = pageData.domain || 'unknown domain';
            code += `        /* Switching to tab ${pageNumber} (${domain}) */\n\n`;
            currentTabNumber = pageNumber;
        }

        const info = action.elementInfo;
        let locator = generateLocator(info);
        const elementDesc = info.text || info.name || info.label || info.role || info.tagName || 'element';
        switch (action.type) {
            case 'click':
                code += `        logger.info(LogBuilder.getLogLine("Clicking on \\"${elementDesc}\\""));\n`;
                code += `        ${locator}.click();\n\n`;
                break;
            case 'search'|| 'fill' || 'input':
                const searchDesc = info.placeholder || info.label || info.name || 'search field';
                code = `        logger.info(LogBuilder.getLogLine("Searching in ${searchDesc} with value \\"${action.value}\\""));\n`;
                code = `        ${locator}.fill("${action.value}");\n\n`;
                break;
            case 'select':
                const selectDesc = info.label || info.name || 'dropdown';
                code += `        logger.info(LogBuilder.getLogLine("Selecting option \\"${action.value}\\" in ${selectDesc}"));\n`;
                code += `        ${locator}.selectOption("${action.value}");\n\n`;
                break;
            case 'hover':
                code += `        logger.info(LogBuilder.getLogLine("Hovering over \\"${elementDesc}\\""));\n`;
                code += `        ${locator}.hover();\n\n`;

            case 'keypress':
                if (action.key) {
                    code += `        logger.info(LogBuilder.getLogLine("Pressing ${action.key} key"));\n`;
                    code += `        ${locator}.press("${action.key}");\n\n`;
                }
                break;

        }

    });

    code += `}\n`;
    return code;
}

function generateLocator(element) {
    if (!element) return 'this.pageController.getPage().locator("body")';

    const page = 'this.pageController.getPage()';

    // Handle form controls with aria-label
    if (element['aria-label']) {
        return `${page}.getByLabel("${escapeQuotes(element['aria-label'])}")`;
    }

    // Handle elements with specific roles
    if (element.role) {
        const options = [];
        if (element.name) options.push(`setName("${escapeQuotes(element.name)}")`);
        if (element.placeholder) options.push(`setPlaceholder("${escapeQuotes(element.placeholder)}")`);

        const roleOptions = options.length > 0
            ? `, new Page.GetByRoleOptions().${options.join('.')}`
            : '';

        return `${page}.getByRole(AriaRole.${element.role.toUpperCase()}${roleOptions})`;
    }

    // Handle elements with placeholder
    if (element.placeholder) {
        return `${page}.getByPlaceholder("${escapeQuotes(element.placeholder)}")`;
    }

    // Handle elements with name attribute
    if (element.name) {
        return `${page}.locator("[name='${escapeQuotes(element.name)}']")`;
    }

    // Rest of the locator strategies...
    if (element.label) {
        return `${page}.getByLabel("${escapeQuotes(element.label)}")`;
    }

    if (element.text) {
        return `${page}.getByText("${escapeQuotes(element.text)}")`;
    }

    if (element.testId) {
        return `${page}.getByTestId("${escapeQuotes(element.testId)}")`;
    }

    if (element.title) {
        return `${page}.getByTitle("${escapeQuotes(element.title)}")`;
    }

    if (element.alt) {
        return `${page}.getByAltText("${escapeQuotes(element.alt)}")`;
    }

    if (element.cssSelector) {
        return `${page}.locator("${escapeQuotes(element.cssSelector)}")`;
    }

    // Default fallback with multiple attributes if available
    const attributes = [];
    if (element.type) attributes.push(`[type="${element.type}"]`);
    if (element.name) attributes.push(`[name="${element.name}"]`);
    if (element.role) attributes.push(`[role="${element.role}"]`);
    if (element['aria-label']) attributes.push(`[aria-label="${element['aria-label']}"]`);
    if (element.placeholder) attributes.push(`[placeholder="${element.placeholder}"]`);

    if (attributes.length > 0) {
        return `${page}.locator("${element.tagName}${attributes.join('')}")`;
    }

    return `${page}.locator("${element.tagName || '*'}")`;
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

function generateActionCode(action) {
    const page = 'this.pageController.getPage()';
    const locator = generateLocator(action.element);
    const logLine = `LogBuilder.getLogLine("${escapeQuotes(action.description)}")`;
    const inputValue = escapeQuotes(action.value);

    switch (action.type) {
        case 'click':
            if (action.element.type === 'text' || action.element.role === 'combobox') {
                return `
                    logger.info(${logLine});
                    // Click on input field
                    ${page}.getByRole(AriaRole.COMBOBOX${action.element['aria-label'] ? `, new Page.GetByRoleOptions().setName("${escapeQuotes(action.element['aria-label'])}")` : ''}).click();`;
            }
            return `logger.info(${logLine});\n${locator}.click();`;

        case 'input':
            const inputType = action.element.type || 'text';
            const elementRole = action.element.role || '';

            if (elementRole === 'combobox' || inputType === 'text') {
                return `
                    logger.info(${logLine});
                    // Click and fill input field
                    ${page}.getByRole(AriaRole.COMBOBOX${action.element['aria-label'] ? `, new Page.GetByRoleOptions().setName("${escapeQuotes(action.element['aria-label'])}")` : ''}).click();
                    ${page}.getByRole(AriaRole.COMBOBOX${action.element['aria-label'] ? `, new Page.GetByRoleOptions().setName("${escapeQuotes(action.element['aria-label'])}")` : ''}).fill("${inputValue}");
                    // Verify input value
                    assertThat(${page}.getByRole(AriaRole.COMBOBOX${action.element['aria-label'] ? `, new Page.GetByRoleOptions().setName("${escapeQuotes(action.element['aria-label'])}")` : ''}).inputValue()).isEqualTo("${inputValue}");`;
            }

            switch (inputType) {
                case 'checkbox':
                    return `
                        logger.info(${logLine});
                        // Check/uncheck checkbox
                        ${locator}.setChecked(${action.value === 'true'});
                        // Verify checkbox state
                        assertThat(${locator}.isChecked()).isEqualTo(${action.value === 'true'});`;

                case 'radio':
                    return `
                        logger.info(${logLine});
                        // Select radio option
                        ${locator}.check();
                        // Verify radio selection
                        assertThat(${locator}.isChecked()).isTrue();`;

                case 'select-one':
                    return `
                        logger.info(${logLine});
                        // Select single option
                        ${locator}.selectOption("${inputValue}");`;

                case 'select-multiple':
                    if (Array.isArray(action.value)) {
                        return `
                            logger.info(${logLine});
                            // Select multiple options
                            ${locator}.selectOption(new String[] {"${action.value.join('", "')}"});`;
                    }
                    return `
                        logger.info(${logLine});
                        // Select single option
                        ${locator}.selectOption("${inputValue}");`;

                case 'date':
                    return `
                        logger.info(${logLine});
                        // Fill date input
                        ${page}.getByLabel("${action.element.label || action.element.placeholder}").fill("${inputValue}");`;

                case 'time':
                    return `
                        logger.info(${logLine});
                        // Fill time input
                        ${page}.getByLabel("${action.element.label || action.element.placeholder}").fill("${inputValue}");`;

                case 'datetime-local':
                    return `
                        logger.info(${logLine});
                        // Fill datetime input
                        ${page}.getByLabel("${action.element.label || action.element.placeholder}").fill("${inputValue}");`;

                case 'file':
                    return `
                        logger.info(${logLine});
                        // Set file input
                        ${locator}.setInputFiles("${inputValue}");`;

                default:
                    return `
                        logger.info(${logLine});
                        // Fill text input
                        ${locator}.click();
                        ${locator}.fill("${inputValue}");
                        // Verify input value
                        assertThat(${locator}.inputValue()).isEqualTo("${inputValue}");`;
            }

        case 'type':
            if (action.element.role === 'combobox') {
                return `
                    logger.info(${logLine});
                    // Type into combobox
                    ${page}.getByRole(AriaRole.COMBOBOX${action.element['aria-label'] ? `, new Page.GetByRoleOptions().setName("${escapeQuotes(action.element['aria-label'])}")` : ''}).type("${inputValue}", new Locator.TypeOptions().setDelay(100));`;
            }
            return `
                logger.info(${logLine});
                // Type text with delay
                ${locator}.type("${inputValue}", new Locator.TypeOptions().setDelay(100));`;

        case 'select':
            if (action.element.multiple) {
                return `
                    logger.info(${logLine});
                    // Select multiple options
                    ${page}.getByLabel("${action.element.label || action.element.name}").selectOption(new String[] {"${action.value.join('", "')}"});`;
            }
            return `
                logger.info(${logLine});
                // Select single option
                ${page}.getByLabel("${action.element.label || action.element.name}").selectOption("${escapeQuotes(action.value)}");`;

        case 'hover':
            return `logger.info(${logLine});\n${locator}.hover();`;

        case 'dragdrop':
            const targetLocator = generateLocator(action.targetElement);
            return `
                logger.info(${logLine});
                // Perform drag and drop
                ${locator}.dragTo(${targetLocator});`;

        case 'keypress':
            return `
                logger.info(${logLine});
                // Press key: ${action.key}
                ${locator}.press("${action.key}");`;

        case 'dblclick':
            return `logger.info(${logLine});\n${locator}.dblclick();`;

        case 'rightclick':
            return `
                logger.info(${logLine});
                // Right click
                ${locator}.click(new Locator.ClickOptions().setButton(MouseButton.RIGHT));`;

        case 'focus':
            return `logger.info(${logLine});\n${locator}.focus();`;

        case 'blur':
            return `logger.info(${logLine});\n${locator}.evaluate(element => element.blur());`;

        case 'clear':
            return `logger.info(${logLine});\n${locator}.clear();`;

        case 'submit':
            return `
                logger.info(${logLine});
                // Submit form
                ${locator}.evaluate(form => form.submit());`;

        default:
            return `logger.info("Unsupported action: ${action.type}");`;
    }
}

function generateInputElementCode(element, value) {
    const page = 'this.pageController.getPage()';
    const locator = generateLocator(element);
    const inputType = element.type || 'text';
    const elementDescription = element.description || 'input field';
    const logLine = `LogBuilder.getLogLine("Interacting with ${elementDescription}")`;

    switch (inputType) {
        case 'text':
        case 'email':
        case 'password':
        case 'search':
        case 'tel':
        case 'url':
        case 'number':
            return `
                logger.info(${logLine});
                // Clear and fill ${inputType} input
                ${locator}.clear();
                ${locator}.fill("${escapeQuotes(value)}");
                // Verify input value
                assertThat(${locator}.inputValue()).isEqualTo("${escapeQuotes(value)}");`;

        case 'checkbox':
            return `
                logger.info(${logLine});
                // Set checkbox state
                ${locator}.setChecked(${value === true || value === 'true'});
                // Verify checkbox state
                assertThat(${locator}.isChecked()).isEqualTo(${value === true || value === 'true'});`;

        case 'radio':
            return `
                logger.info(${logLine});
                // Select radio option
                ${locator}.check();
                // Verify radio selection
                assertThat(${locator}.isChecked()).isTrue();`;

        case 'file':
            return `
                logger.info(${logLine});
                // Set file input
                ${locator}.setInputFiles(new Path[] {Paths.get("${escapeQuotes(value)}")});`;

        case 'date':
        case 'datetime-local':
        case 'month':
        case 'time':
        case 'week':
            return `
                logger.info(${logLine});
                // Set date/time input
                ${locator}.fill("${escapeQuotes(value)}");
                // Verify date/time value
                assertThat(${locator}.inputValue()).isEqualTo("${escapeQuotes(value)}");`;

        case 'color':
            return `
                logger.info(${logLine});
                // Set color input
                ${locator}.fill("${escapeQuotes(value)}");`;

        case 'range':
            return `
                logger.info(${logLine});
                // Set range input
                ${locator}.fill("${value}");
                // Verify range value
                assertThat(${locator}.inputValue()).isEqualTo("${value}");`;

        default:
            return `
                logger.info(${logLine});
                // Handle unknown input type: ${inputType}
                ${locator}.fill("${escapeQuotes(value)}");`;
    }
}

function escapeQuotes(str) {
    if (str === null || str === undefined) return '';
    return str.toString().replace(/"/g, '\\"');
}
