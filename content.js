console.log("Content script loaded");

// Global state variables
const state = {
    isRecording: false,
    processingAction: false,
    isContextValid: true,
    lastHoverTarget: null,
    settings: {
        captureHover: false,
        captureBlurFocus: false
    },
    currentInput: {
        element: null,
        value: null
    },
    isAssertionMode: false
};

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
    if (!state.isContextValid) return; // Prevent multiple invalidations

    state.isContextValid = false;
    state.isRecording = false;
    state.processingAction = false;

    console.log('Extension context invalidated, stopping recording');
    removeAllListeners();

    // Try to notify the popup if possible
    try {
        chrome.runtime.sendMessage({
            action: 'contextInvalidated'
        }).catch(() => {
            // Ignore errors here as the context is already invalid
        });
    } catch (e) {
        // Ignore errors when trying to send the message
    }
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
    try {
        for (const [eventType, listeners] of eventListeners) {
            for (const { element, handler, options } of listeners) {
                try {
                    element.removeEventListener(eventType, handler, options);
                } catch (error) {
                    console.log(`Failed to remove listener for ${eventType}:`, error);
                }
            }
        }
        eventListeners.clear();
    } catch (error) {
        console.log('Error cleaning up listeners:', error);
    }
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
        if (!element?.nodeType || element.nodeType !== 1) {
            return `unknown-element-${Date.now()}`;
        }

        const strategies = [
            getTextContentSelector,
            getIdSelector,
            getDataTestIdSelector,
            getRoleWithTextContentSelector,
            getAriaLabelSelector,
            getPlaceholderSelector,
            getNameSelector,
            getRoleSelector,
            getClassSelector,
            getXPathSelector
        ];

        for (const strategy of strategies) {
            const selector = strategy(element);
            if (selector) return selector;
        }

        return `${element.tagName.toLowerCase()}[${Math.floor(Math.random() * 10000)}]`;
    } catch (error) {
        console.error('Error getting unique selector:', error);
        return `fallback-selector-${Date.now()}`;
    }
}

function getTextContentSelector(element) {
    if ((element.tagName === 'BUTTON' || element.tagName === 'A') && element.textContent?.trim()) {
        return `text="${element.textContent.trim()}"`;
    }
    return null;
}

function getIdSelector(element) {
    if (element.id) {
        return `#${element.id}`;
    }
    return null;
}

function getDataTestIdSelector(element) {
    if (element.dataset?.testid) {
        return `[data-testid="${element.dataset.testid}"]`;
    }
    return null;
}

function getRoleWithTextContentSelector(element) {
    const role = element.getAttribute('role') || getImplicitRole(element);
    if (role && supportedAriaRoles.has(role.toLowerCase()) && element.textContent?.trim()) {
        return `role=${role}[name="${element.textContent.trim()}"]`;
    }
    return null;
}

function getAriaLabelSelector(element) {
    if (element.getAttribute('aria-label')) {
        return `[aria-label="${element.getAttribute('aria-label')}"]`;
    }
    return null;
}

function getPlaceholderSelector(element) {
    if (element.placeholder) {
        return `[placeholder="${element.placeholder}"]`;
    }
    return null;
}

function getNameSelector(element) {
    if (element.name) {
        return `[name="${element.name}"]`;
    }
    return null;
}

function getRoleSelector(element) {
    const role = element.getAttribute('role') || getImplicitRole(element);
    if (role && supportedAriaRoles.has(role.toLowerCase())) {
        return `role=${role}`;
    }
    return null;
}

function getClassSelector(element) {
    if (element.className && typeof element.className === 'string' && !element.className.includes(' ')) {
        try {
            const elementsWithClass = document.getElementsByClassName(element.className);
            if (elementsWithClass.length === 1) {
                return `.${element.className}`;
            }
        } catch (error) {
            console.error('Error checking class uniqueness:', error);
        }
    }
    return null;
}

function getXPathSelector(element) {
    const xpath = generateXPath(element);
    if (xpath) {
        return xpath;
    }
    return null;
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
        if (!isValidElement(element)) {
            return null;
        }

        if (element === document.body) {
            return '/html/body';
        }

        let path = '';
        let current = element;

        while (isValidElement(current) && current !== document.body) {
            const selector = getElementSelector(current);
            if (!selector) break;

            path = selector + (path ? '/' + path : '');
            current = current.parentNode;
        }

        return path ? '//' + path : null;
    } catch (error) {
        console.error('Error generating XPath:', error);
        return `//${element.tagName.toLowerCase()}[${Math.floor(Math.random() * 10000)}]`;
    }
}

function isValidElement(element) {
    return element && element.nodeType === 1;
}

function getElementSelector(element) {
    const tagName = element.tagName.toLowerCase();
    const parent = element.parentNode;
    if (!parent?.children) return null;

    const siblings = Array.from(parent.children).filter(child => child.tagName === element.tagName);
    let selector = tagName;

    if (siblings.length > 1) {
        const index = siblings.indexOf(element) + 1;
        selector += `[${index}]`;
    }

    if (element.id) {
        selector += `[@id="${element.id}"]`;
    } else if (element.className && typeof element.className === 'string') {
        const classes = element.className.trim().split(/\s+/);
        if (classes.length > 0) {
            selector += `[contains(@class, "${classes[0]}")]`;
        }
    }

    return selector;
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
    if (!element?.tagName) return null;

    const info = initializeElementInfo(element);

    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) {
        info.text = element.textContent?.trim() || null;
    }

    handleSvgElements(element, info);
    info.label = getLabel(element) || getAriaLabel(element) || getAriaLabelledBy(element) || getValueOrPlaceholder(element);
    info.name = getNameForButtonOrLink(element);

    return info;
}

function initializeElementInfo(element) {
    return {
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
}

function handleSvgElements(element, info) {
    if (element.tagName === 'svg' || element.closest('svg')) {
        const svgElement = element.tagName === 'svg' ? element : element.closest('svg');
        const parent = svgElement.parentElement;

        if (parent && parent.tagName !== 'svg') {
            info.isSVGWithParent = true;
            info.originalSVG = {
                tagName: svgElement.tagName,
                role: svgElement.getAttribute('role') || null
            };

            info.role = parent.getAttribute('role') || info.role;
            info.text = parent.textContent?.trim() || info.text;
            info.testId = parent.getAttribute('data-testid') || info.testId;
            info.title = parent.getAttribute('title') || info.title;
        }
    }
}

function getLabel(element) {
    const labelElement = element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA' ?
        element.labels?.[0] || document.querySelector(`label[for="${element.id}"]`) : null;

    return labelElement ? labelElement.textContent?.trim() || null : null;
}

function getAriaLabel(element) {
    return element.getAttribute('aria-label') || null;
}

function getAriaLabelledBy(element) {
    if (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA') {
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            const labelElement = document.getElementById(labelledBy);
            return labelElement ? labelElement.textContent?.trim() || null : null;
        }
    }
    return null;
}

function getValueOrPlaceholder(element) {
    if (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA') {
        return element.value || element.placeholder || null;
    }
    return null;
}

function getNameForButtonOrLink(element) {
    if (element.tagName === 'BUTTON' || (element.tagName === 'A' && element.href)) {
        return element.getAttribute('aria-label') || element.title || element.textContent?.trim() || null;
    }
    return null;
}

// Function to get current page information
async function getPageInfo() {
    if (!state.isContextValid) {
        console.log('Extension context is invalid, skipping page info request');
        return null;
    }

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'getPageInfo',
            timestamp: Date.now() // Add timestamp for debugging
        });

        if (!response?.pageInfo) {
            console.warn('Invalid page info response:', response);
            return null;
        }

        return response.pageInfo;
    } catch (error) {
        if (error.message.includes('Extension context invalidated')) {
            handleContextInvalidated();
        } else {
            console.error('Error getting page info:', error);
        }
        return null;
    }
}

// Function to record an action with deduplication
async function recordAction(type, event, value = null) {
    if (!state.isContextValid || !state.isRecording || state.processingAction) {
        console.log('Skipping action recording:', {
            contextValid: state.isContextValid,
            recording: state.isRecording,
            processing: state.processingAction
        });
        return;
    }

    state.processingAction = true;
    try {
        const target = event.target;
        const elementInfo = getElementInfo(target);
        const pageInfo = await getPageInfo();

        // Skip if we couldn't get page info
        if (!pageInfo) {
            console.warn('Skipping action recording - no page info available');
            return;
        }

        const action = {
            type,
            timestamp: Date.now(),
            elementInfo,
            value,
            pageInfo,
            url: window.location.href
        };

        await sendMessageSafely({
            type: 'actionRecorded',
            action
        });
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

    if (target.value) {
        await recordAction('input', event, target.value);
    }
}

// Set up event listeners with error handling
addTrackedListener(document, 'click', async (event) => {
    if (!state.isRecording) return;

    if (state.isAssertionMode) {
        await recordAction('assertion', event);
        state.isAssertionMode = false;
        chrome.runtime.sendMessage({ action: 'assertionCaptured' });
        return;
    }

    // Record input value if clicking away from input field
    if (state.currentInput.element &&
        event.target !== state.currentInput.element &&
        state.currentInput.value) {
        await recordAction('input', { target: state.currentInput.element }, state.currentInput.value);
        console.log('Input value recorded on click away:', state.currentInput.value);
        state.currentInput = { element: null, value: null };
    }

    await recordAction('click', event);
}, { capture: true, passive: true });

// Handle hover events
addTrackedListener(document, 'mouseover', async (event) => {
    if (!state.isRecording || !state.settings.captureHover) return;
    const target = event.target;

    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

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

    if (!['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

    // Only store the value, don't record action yet
    state.currentInput = {
        element: target,
        value: target.value
    };
    console.log('Input value stored:', target.value);
}, { capture: true, passive: true });

addTrackedListener(document, 'change', async (event) => {
    if (!state.isRecording) return;
    const target = event.target;

    if (target.tagName === 'SELECT') {
        console.log('Select changed:', target.value);
        await recordAction('select', event, target.value);
    }
}, { capture: true, passive: true });

addTrackedListener(document, 'focus', async (event) => {
    if (!state.isRecording || !state.settings.captureBlurFocus) return;
    await recordAction('focus', event);
}, { capture: true, passive: true });

addTrackedListener(document, 'blur', async (event) => {
    if (!state.isRecording || !state.settings.captureBlurFocus) return;
    const target = event.target;

    // Record final input value if it exists
    if (['INPUT', 'TEXTAREA'].includes(target.tagName) &&
        state.currentInput.element === target &&
        state.currentInput.value) {
        await recordAction('input', event, state.currentInput.value);
        state.currentInput.element = null;
        state.currentInput.value = null;
    }

    await recordAction('blur', event);
}, { capture: true, passive: true });

// Handle Enter key press
document.addEventListener('keydown', async (event) => {
    if (!state.isRecording) return;

    if (event.key === 'Enter' && state.currentInput.element) {
        // Record the final input value
        if (state.currentInput.value) {
            await recordAction('input', { target: state.currentInput.element }, state.currentInput.value);
            console.log('Input value recorded on Enter:', state.currentInput.value);
        }

        // Clear the stored input state
        state.currentInput = { element: null, value: null };

        // Record the Enter key press
        await recordAction('keypress', event, 'Enter');
    }
}, { capture: true, passive: true });

// Handle form submissions
document.addEventListener('submit', async (event) => {
    if (state.isRecording) {
        const form = event.target;
        const inputs = Array.from(form.querySelectorAll('input'));
        for (const input of inputs) {
            if (input === state.currentInput.element) {
                await handleInputCompletion({ target: input });
            }
        }
    }
}, { capture: true, passive: true });

document.addEventListener('change', async (event) => {
    if (state.isRecording && event.target.tagName === 'SELECT') {
        await recordAction('select', event, event.target.value);
    }
}, { capture: true, passive: true });

// Message listener with error handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let handled = false;

    // Handle ping message synchronously
    if (message.action === 'ping') {
        sendResponse({ status: 'pong' });
        handled = true;
    }

    // Handle settings update
    if (message.action === 'updateSettings') {
        state.settings = message.settings;
        console.log('Settings updated:', state.settings);
        sendResponse({ status: 'success' });
        handled = true;
    }

    // Handle recording toggle synchronously
    if (message.action === 'toggleRecording') {
        try {
            state.isRecording = message.isRecording;
            console.log('Recording state changed:', state.isRecording);
            sendResponse({ status: 'success' });
        } catch (error) {
            console.error('Error handling toggle:', error);
            sendResponse({ status: 'error', message: error.message });
        }
        handled = true;
    }

    // Handle assertion mode
    if (message.action === 'toggleAssertionMode') {
        state.isAssertionMode = message.isAssertionMode;
        console.log('Assertion mode:', state.isAssertionMode);
    }

    return handled;
});

// Replace the unload event listener with a more compatible solution
// Remove this:
window.addEventListener('unload', () => {
    removeAllListeners();
});

// Add this instead:
function setupCleanup() {
    try {
        // Try using beforeunload first
        window.addEventListener('beforeunload', () => {
            removeAllListeners();
        });
    } catch (error) {
        console.log('Could not add beforeunload listener:', error);
    }

    // Also clean up when extension context changes
    chrome.runtime.onConnect.addListener((port) => {
        port.onDisconnect.addListener(() => {
            removeAllListeners();
        });
    });
}

// Call setupCleanup when content script loads
setupCleanup();

// Add these event listeners after existing ones

// Double click
addTrackedListener(document, 'dblclick', async (event) => {
    if (!state.isRecording) return;
    await recordAction('doubleClick', event);
}, { capture: true, passive: true });

// Right click
addTrackedListener(document, 'contextmenu', async (event) => {
    if (!state.isRecording) return;
    await recordAction('rightClick', event);
}, { capture: true, passive: true });

// File upload
addTrackedListener(document, 'change', async (event) => {
    if (!state.isRecording) return;
    const target = event.target;

    if (target.type === 'file') {
        const files = Array.from(target.files).map(file => file.name);
        await recordAction('fileUpload', event, files);
    }
}, { capture: true, passive: true });

// Checkbox/Radio
addTrackedListener(document, 'change', async (event) => {
    if (!state.isRecording) return;
    const target = event.target;

    if (target.type === 'checkbox') {
        await recordAction(target.checked ? 'check' : 'uncheck', event);
    } else if (target.type === 'radio') {
        await recordAction('check', event);
    }
}, { capture: true, passive: true });

// Clear input (detect when input is cleared)
addTrackedListener(document, 'input', async (event) => {
    if (!state.isRecording) return;
    const target = event.target;

    if (['INPUT', 'TEXTAREA'].includes(target.tagName) && !target.value) {
        await recordAction('clear', event);
    }
}, { capture: true, passive: true });

// Special keys (update existing keydown handler)
document.addEventListener('keydown', async (event) => {
    if (!state.isRecording) return;

    const specialKeys = ['Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (specialKeys.includes(event.key)) {
        await recordAction('keyPress', event, event.key);
    }
}, { capture: true, passive: true });
