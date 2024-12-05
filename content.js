console.log("Content script loaded");

// Global state variables
const state = {
    isRecording: false,
    processingAction: false,
    isContextValid: true,
    lastHoverTarget: null,
    settings: {
        captureHover: false
    }
};

// Tracking maps
const recentActions = new Map();
const inputTracker = new Map();

// Define supported ARIA roles
const supportedAriaRoles = new Set([
    'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button',
    'caption', 'cell', 'checkbox', 'code', 'columnheader', 'combobox', 'complementary',
    'contentinfo', 'definition', 'deletion', 'dialog', 'directory', 'document', 'emphasis',
    'feed', 'figure', 'form', 'generic', 'grid', 'gridcell', 'group', 'heading', 'img',
    'insertion', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math',
    'meter', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation',
    'none', 'note', 'option', 'paragraph', 'presentation', 'progressbar', 'radio', 'radiogroup',
    'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator',
    'slider', 'spinbutton', 'status', 'strong', 'subscript', 'superscript', 'switch', 'tab',
    'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer', 'toolbar', 'tooltip',
    'tree', 'treegrid', 'treeitem'
]);

// Track last input action
let lastInputAction = null;

// Function to handle input actions
function handleInputAction(action) {
    lastInputAction = action;
}

// Function to check if action is input type
function isInputAction(action) {
    return action.type === 'search' || action.type === 'fill' || action.type === 'input';
}

// Function to handle keydown events
function handleKeyDown(event) {
    if (event.key === 'Enter' && lastInputAction) {
        // Send both the input action and the enter key action
        chrome.runtime.sendMessage({
            type: 'ACTION',
            action: {
                type: 'keypress',
                key: 'Enter',
                element: lastInputAction.element,
                value: lastInputAction.value,
                description: 'Pressed Enter after input'
            }
        });
        lastInputAction = null; // Reset last input action
    }
}

// Add keydown event listener
document.addEventListener('keydown', handleKeyDown);

// Handle extension context invalidation
function handleContextInvalidated() {
    state.isContextValid = false;
    state.isRecording = false;
    removeAllListeners();
    console.log('Extension context invalidated, recording stopped');
}

// Store event listener references for cleanup
const eventListeners = new Map();

// Function to add event listener with tracking
function addTrackedListener(element, eventType, handler, options) {
    const wrappedHandler = async (...args) => {
        if (!state.isContextValid) return;
        try {
            await handler(...args);
        } catch (error) {
            if (error.message.includes('Extension context invalidated')) {
                handleContextInvalidated();
            } else {
                console.error(`Error in ${eventType} handler:`, error);
            }
        }
    };

    element.addEventListener(eventType, wrappedHandler, options);
    if (!eventListeners.has(eventType)) {
        eventListeners.set(eventType, []);
    }
    eventListeners.get(eventType).push({ element, handler: wrappedHandler, options });
}

// Function to remove all event listeners
function removeAllListeners() {
    for (const [eventType, listeners] of eventListeners) {
        for (const { element, handler, options } of listeners) {
            element.removeEventListener(eventType, handler, options);
        }
    }
    eventListeners.clear();
}

// Function to safely send messages
async function sendMessageSafely(message) {
    if (!state.isContextValid) return;
    try {
        return await chrome.runtime.sendMessage(message);
    } catch (error) {
        if (error.message.includes('Extension context invalidated')) {
            handleContextInvalidated();
        }
        throw error;
    }
}

// Function to get unique selector for an element
function getUniqueSelector(element) {
    try {
        // Handle null or invalid element
        if (!element || !element.nodeType || element.nodeType !== 1) {
            return `unknown-element-${Date.now()}`;
        }

        // 1. Try text content for buttons and links (most reliable for interactive elements)
        if ((element.tagName === 'BUTTON' || element.tagName === 'A') && element.textContent?.trim()) {
            return `text="${element.textContent.trim()}"`;
        }

        // 2. Try ID (very reliable if present)
        if (element.id) {
            return `#${element.id}`;
        }

        // 3. Try data-testid (commonly used for testing)
        if (element.dataset?.testid) {
            return `[data-testid="${element.dataset.testid}"]`;
        }

        // 4. Try role with text content (good for accessibility and uniqueness)
        const role = element.getAttribute('role') || getImplicitRole(element);
        if (role && supportedAriaRoles.has(role.toLowerCase()) && element.textContent?.trim()) {
            return `role=${role}[name="${element.textContent.trim()}"]`;
        }

        // 5. Try aria-label (good for accessibility)
        if (element.getAttribute('aria-label')) {
            return `[aria-label="${element.getAttribute('aria-label')}"]`;
        }

        // 6. Try placeholder for inputs (common for form fields)
        if (element.placeholder) {
            return `[placeholder="${element.placeholder}"]`;
        }

        // 7. Try name attribute for form elements
        if (element.name) {
            return `[name="${element.name}"]`;
        }

        // 8. Try role only if available
        if (role && supportedAriaRoles.has(role.toLowerCase())) {
            return `role=${role}`;
        }

        // 9. Try class if it's simple and unique
        if (element.className && typeof element.className === 'string' && !element.className.includes(' ')) {
            try {
                // Check if this class is unique in the document
                const elementsWithClass = document.getElementsByClassName(element.className);
                if (elementsWithClass.length === 1) {
                    return `.${element.className}`;
                }
            } catch (error) {
                console.error('Error checking class uniqueness:', error);
            }
        }

        // 10. Fallback to XPath as last resort
        const xpath = generateXPath(element);
        if (xpath) {
            return xpath;
        }

        // Ultimate fallback
        return `${element.tagName.toLowerCase()}[${Math.floor(Math.random() * 10000)}]`;
    } catch (error) {
        console.error('Error getting unique selector:', error);
        return `fallback-selector-${Date.now()}`;
    }
}

// Function to get implicit ARIA role
function getImplicitRole(element) {
    const tagToRole = {
        'a': 'link',
        'button': 'button',
        'h1': 'heading',
        'h2': 'heading',
        'h3': 'heading',
        'h4': 'heading',
        'h5': 'heading',
        'h6': 'heading',
        'img': 'img',
        'input': getInputRole(element),
        'select': 'combobox',
        'textarea': 'textbox',
        'article': 'article',
        'aside': 'complementary',
        'footer': 'contentinfo',
        'form': 'form',
        'header': 'banner',
        'main': 'main',
        'nav': 'navigation',
        'section': 'region'
    };
    return tagToRole[element.tagName.toLowerCase()];
}

// Function to get role for input elements
function getInputRole(element) {
    if (element.tagName !== 'INPUT') return null;
    const inputTypeToRole = {
        'button': 'button',
        'checkbox': 'checkbox',
        'radio': 'radio',
        'range': 'slider',
        'search': 'searchbox',
        'spinbutton': 'spinbutton',
        'text': 'textbox',
        'email': 'textbox',
        'tel': 'textbox',
        'url': 'textbox',
        'number': 'spinbutton'
    };
    return inputTypeToRole[element.type] || 'textbox';
}

// Function to generate unique XPath
function generateXPath(element) {
    try {
        // Handle null or invalid element
        if (!element || !element.nodeType || element.nodeType !== 1) {
            return null;
        }

        // Handle document body
        if (element === document.body) {
            return '/html/body';
        }

        let path = '';
        let current = element;

        while (current && current !== document.body && current.parentNode) {
            let selector = current.tagName.toLowerCase();

            // Get parent node safely
            const parent = current.parentNode;
            if (!parent || !parent.children) {
                // If we can't get parent or its children, break the loop
                break;
            }

            // Get siblings safely
            const siblings = Array.from(parent.children).filter(child =>
                child.tagName === current.tagName
            );

            // Add index if there are multiple siblings with same tag
            if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += `[${index}]`;
            }

            // Add identifying attributes if available
            if (current.id) {
                selector += `[@id="${current.id}"]`;
            } else if (current.className && typeof current.className === 'string') {
                const classes = current.className.trim().split(/\s+/);
                if (classes.length > 0) {
                    selector += `[contains(@class, "${classes[0]}")]`;
                }
            }

            // Build path
            path = selector + (path ? '/' + path : '');
            current = parent;
        }

        return path ? '//' + path : null;
    } catch (error) {
        console.error('Error generating XPath:', error);
        // Return a basic unique selector as fallback
        return `//${element.tagName.toLowerCase()}[${Math.floor(Math.random() * 10000)}]`;
    }
}

// Function to find closest interactive parent
function findInteractiveParent(element) {
    const interactiveTags = ['button', 'a', 'input', 'select', 'textarea'];
    const interactiveRoles = ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio'];

    let current = element;
    while (current && current !== document.body) {
        // Check if current element is interactive
        const isInteractiveTag = interactiveTags.includes(current.tagName.toLowerCase());
        const role = current.getAttribute('role');
        const isInteractiveRole = role && interactiveRoles.includes(role.toLowerCase());
        const hasClickHandler = current.hasAttribute('onclick') || current.hasAttribute('click');

        if (isInteractiveTag || isInteractiveRole || hasClickHandler) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}

// Function to get element information
function getElementInfo(element) {
    if (!element || !element.tagName) return null;

    const info = {
        tagName: element.tagName,
        id: element.id || null,
        className: element.className || null,
        name: element.getAttribute('name') || null,
        type: element.getAttribute('type') || null,
        value: element.value || null,
        placeholder: element.getAttribute('placeholder') || null,
        label: null,
        role: element.getAttribute('role') || null,
        text: null,
        title: element.getAttribute('title') || null,
        testId: element.getAttribute('data-testid') || null
    };

    // Get text content for non-form elements
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) {
        info.text = element.textContent?.trim() || null;
    }

    // Handle SVG elements with interactive parent
    if (element.tagName === 'svg' || element.closest('svg')) {
        const svgElement = element.tagName === 'svg' ? element : element.closest('svg');
        const parent = svgElement.parentElement;

        if (parent && parent.tagName !== 'svg') {
            info.isSVGWithParent = true;
            info.originalSVG = {
                tagName: svgElement.tagName,
                role: svgElement.getAttribute('role') || null
            };

            // Use parent's attributes for better targeting
            info.role = parent.getAttribute('role') || info.role;
            info.text = parent.textContent?.trim() || info.text;
            info.testId = parent.getAttribute('data-testid') || info.testId;
            info.title = parent.getAttribute('title') || info.title;
        }
    }

    // Get associated label text
    const labelElement = element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA' ?
        element.labels?.[0] || document.querySelector(`label[for="${element.id}"]`) : null;

    if (labelElement) {
        info.label = labelElement.textContent?.trim() || null;
    }

    // Get aria-label if available
    if (!info.label) {
        info.label = element.getAttribute('aria-label') || null;
    }

    // For form controls, also check for aria-labelledby
    if (!info.label && (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA')) {
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            const labelElement = document.getElementById(labelledBy);
            if (labelElement) {
                info.label = labelElement.textContent?.trim() || null;
            }
        }
    }

    // Check for value and placeholder
    if (!info.label && (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA')) {
        info.label = element.value || element.placeholder || null;
    }

    // Get name from aria-label or title for buttons and links
    if (!info.name && (element.tagName === 'BUTTON' || (element.tagName === 'A' && element.href))) {
        info.name = element.getAttribute('aria-label') || element.title || element.textContent?.trim() || null;
    }

    return info;
}

// Function to get current page information
async function getPageInfo() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getPageInfo' });
        return response.pageInfo;
    } catch (error) {
        console.error('Error getting page info:', error);
        return { pageNumber: 0 };
    }
}

// Function to record an action with deduplication
async function recordAction(type, event, value = null) {
    if (!state.isContextValid || !state.isRecording || state.processingAction) return;

    state.processingAction = true;
    try {
        const timestamp = Date.now();
        const target = event.target;

        // Validate target element
        if (!target || !target.nodeType || target.nodeType !== 1) {
            console.warn('Invalid target element:', target);
            return;
        }

        // Create a unique key for the action
        const actionKey = `${type}-${generateXPath(target) || target.tagName}-${value || ''}-${Math.floor(timestamp/500)}`;

        // Check if we've recorded this action recently
        if (recentActions.has(actionKey)) {
            console.log('Duplicate action detected, skipping:', actionKey);
            return;
        }

        // Get element information
        const elementInfo = getElementInfo(target);
        if (!elementInfo) {
            console.warn('Could not get element information');
            return;
        }

        // Get page information from background script
        const pageInfo = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getPageInfo' }, (response) => {
                resolve(response?.pageInfo || { pageNumber: 0 });
            });
        });

        const action = {
            type,
            timestamp,
            elementInfo,
            value,
            pageInfo,
            url: window.location.href
        };

        console.log('Recording action:', action);

        // Store in recent actions map with expiration
        recentActions.set(actionKey, timestamp);
        setTimeout(() => recentActions.delete(actionKey), 500);

        // Send to background script
        await sendMessageSafely({
            type: 'actionRecorded',
            action
        });

        console.log('Action recorded successfully:', action);
    } catch (error) {
        console.error('Error recording action:', error);
    } finally {
        state.processingAction = false;
    }
}

// Function to handle input completion
async function handleInputCompletion(event) {
    const target = event.target;
    if (!state.isRecording || !target || !['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

    const initialValue = inputTracker.get(target);
    const currentValue = target.value;

    // Only record if the value has changed from its initial state
    if (initialValue !== currentValue) {
        console.log('Input completed:', { initial: initialValue, current: currentValue });
        await recordAction('input', event, currentValue);
        inputTracker.delete(target); // Clear the tracker for this input
    }
}

// Function to handle pending input values
async function handlePendingInputs(excludeElement = null) {
    const inputs = Array.from(document.querySelectorAll('input, textarea'));
    for (const input of inputs) {
        if (input !== excludeElement && inputTracker.has(input)) {
            await handleInputCompletion({ target: input });
        }
    }
}

// Set up event listeners with error handling
addTrackedListener(document, 'click', async (event) => {
    if (!state.isRecording) return;

    const target = event.target;
    const isFormElement = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && target.type !== 'submit';

    if (!isFormElement) {
        await handlePendingInputs();
        await recordAction('click', event);
    }
}, { capture: true, passive: true });

// Handle hover events
addTrackedListener(document, 'mouseover', async (event) => {
    if (!state.isRecording || !state.settings.captureHover) return;
    const target = event.target;

    // Skip hover recording for form elements and small movements
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

    // Create a debounced hover recording
    if (state.lastHoverTarget !== target) {
        state.lastHoverTarget = target;
        await recordAction('hover', event);
    }
}, { capture: true, passive: true });

// Handle drag and drop events
let dragStartElement = null;
let dragStartData = null;

addTrackedListener(document, 'dragstart', async (event) => {
    if (!state.isRecording) return;
    dragStartElement = event.target;
    dragStartData = {
        x: event.clientX,
        y: event.clientY
    };
    await recordAction('dragStart', event);
}, { capture: true });

addTrackedListener(document, 'drop', async (event) => {
    if (!state.isRecording || !dragStartElement) return;

    const dropData = {
        startX: dragStartData.x,
        startY: dragStartData.y,
        endX: event.clientX,
        endY: event.clientY,
        sourceElement: dragStartElement
    };

    await recordAction('drop', event, dropData);
    dragStartElement = null;
    dragStartData = null;
}, { capture: true });

// Handle input events
addTrackedListener(document, 'input', async (event) => {
    if (!state.isRecording) return;
    const target = event.target;

    if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
        inputTracker.set(target, target.value);
        console.log('Input tracked:', target.value);
        const initialValue = inputTracker.get(target);
    const currentValue = target.value;

    // Only record if the value has changed from its initial state
    if (initialValue !== currentValue) {
        await recordAction('input', event, currentValue);
        inputTracker.delete(target); // Clear the tracker for this input
    }
    }
}, { capture: true, passive: true });

async function handlePendingInputs(excludeElement = null) {
    const inputs = Array.from(document.querySelectorAll('input'));
    for (const input of inputs) {
        if (input !== excludeElement && inputTracker.has(input)) {
            await handleInputCompletion({ target: input });
        }
    }
}

addTrackedListener(document, 'change', async (event) => {
    if (!state.isRecording) return;
    const target = event.target;

    if (target.tagName === 'SELECT') {
        console.log('Select changed:', target.value);
        await recordAction('select', event, target.value);
    }
}, { capture: true, passive: true });

addTrackedListener(document, 'focus', (event) => {
    if (!state.isRecording) return;
    const target = event.target;

    if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
        inputTracker.set(target, target.value);
        console.log('Focus tracked:', target.value);
    }
}, { capture: true, passive: true });

addTrackedListener(document, 'blur', async (event) => {
    if (!state.isRecording) return;
    const target = event.target;

    if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
        console.log('Blur event, checking input completion');
        await handleInputCompletion(event);
    }
}, { capture: true, passive: true });

// Handle Enter key press
document.addEventListener('keydown', async (event) => {
    if (isRecording && event.key === 'Enter' && event.target.tagName === 'INPUT') {
        await handleInputCompletion(event);
    }
}, { capture: true, passive: true });

// Handle form submissions
document.addEventListener('submit', async (event) => {
    if (isRecording) {
        const form = event.target;
        const inputs = Array.from(form.querySelectorAll('input'));
        for (const input of inputs) {
            if (inputTracker.has(input)) {
                await handleInputCompletion({ target: input });
            }
        }
    }
}, { capture: true, passive: true });

document.addEventListener('change', async (event) => {
    if (isRecording && event.target.tagName === 'SELECT') {
        await recordAction('select', event, event.target.value);
    }
}, { capture: true, passive: true });

// Message listener with error handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle ping message synchronously
    if (message.action === 'ping') {
        sendResponse({ status: 'pong' });
        return false;
    }

    // Handle settings update
    if (message.action === 'updateSettings') {
        state.settings = message.settings;
        console.log('Settings updated:', state.settings);
        sendResponse({ status: 'success' });
        return false;
    }

    // Handle recording toggle synchronously
    if (message.action === 'toggleRecording') {
        try {
            state.isRecording = message.isRecording;
            console.log('Recording state changed:', state.isRecording);

            if (state.isRecording) {
                recentActions.clear();
                inputTracker.clear();
            }
            sendResponse({ status: 'success' });
        } catch (error) {
            console.error('Error handling toggle:', error);
            sendResponse({ status: 'error', message: error.message });
        }
        return false;
    }

    return false;
});

// Handle extension unload
window.addEventListener('unload', () => {
    removeAllListeners();
});
