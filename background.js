let isRecording = false;
const tabsInfo = new Map(); // Track information for each tab
let currentPageCount = 0;
const injectedTabs = new Set(); // Track tabs where content script is injected

// Initialize recording state
chrome.runtime.onInstalled.addListener(async () => {
    await chrome.storage.local.set({
        isRecording: false,
        recordedActions: [],
        pageCounter: 0,
        tabsMapping: {}
    });
    console.log('Extension installed, recording state initialized');

    // Set up side panel behavior
    if (chrome.sidePanel) {
        try {
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
            console.log('Side panel behavior set successfully');
        } catch (error) {
            console.error('Error setting side panel behavior:', error);
        }
    }
});

// Function to check if URL is valid for injection
function isValidUrl(url) {
    if (!url) return false;

    try {
        const urlObj = new URL(url);

        // List of restricted URL patterns
        const restrictedPatterns = [
            'chrome://',
            'chrome-extension://',
            'chrome.google.com/webstore',
            'chrome-error://',
            'about:',
            'edge://',
            'view-source:',
            'devtools://',
            'file://',
            'https://chrome.google.com/webstore'
        ];

        // Check against restricted patterns
        for (const pattern of restrictedPatterns) {
            if (url.startsWith(pattern) || url.includes(pattern)) {
                console.log(`URL matches restricted pattern ${pattern}:`, url);
                return false;
            }
        }

        // Additional checks for valid URLs
        if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
            console.log('Invalid protocol:', urlObj.protocol);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error validating URL:', error);
        return false;
    }
}

// Function to check if content script is already injected
async function isContentScriptInjected(tabId) {
    try {
        // Add timeout to prevent hanging
        const response = await Promise.race([
            chrome.tabs.sendMessage(tabId, { action: 'ping' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
        ]);
        return response && response.status === 'pong';
    } catch (error) {
        if (error.message === 'Timeout') {
            console.log('Ping timeout for tab:', tabId);
        }
        return false;
    }
}

// Function to inject content script with retry
async function injectContentScript(tabId, retryCount = 0) {
    try {
        // Check if we can access the tab
        const tab = await chrome.tabs.get(tabId);

        // Validate URL
        if (!isValidUrl(tab.url)) {
            console.log('Skipping injection for restricted page:', tab.url);
            return false;
        }

        // Check if already injected and responding
        if (injectedTabs.has(tabId)) {
            const isStillInjected = await isContentScriptInjected(tabId);
            if (isStillInjected) {
                console.log('Content script already active in tab:', tabId);
                return true;
            } else {
                console.log('Removing non-responsive tab from injected set:', tabId);
                injectedTabs.delete(tabId);
            }
        }

        // Inject the content script
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content.js']
            });

            // Verify injection was successful
            const isInjected = await isContentScriptInjected(tabId);
            if (isInjected) {
                injectedTabs.add(tabId);
                console.log('Content script injected and verified in tab:', tabId);
                return true;
            } else if (retryCount < 2) {
                console.log('Injection verification failed, retrying...');
                await new Promise(resolve => setTimeout(resolve, 100));
                return injectContentScript(tabId, retryCount + 1);
            } else {
                console.error('Failed to verify content script injection after retries');
                return false;
            }
        } catch (error) {
            if (error.message.includes('cannot be scripted')) {
                console.log('Page cannot be scripted:', tab.url);
            } else {
                console.error('Error injecting content script:', error);
            }
            return false;
        }
    } catch (error) {
        console.error('Error in injectContentScript:', error);
        return false;
    }
}

// Handle tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        // Skip if URL is not valid for injection
        if (!isValidUrl(tab.url)) {
            console.log('Skipping restricted page:', tab.url);
            return;
        }

        if (isRecording) {
            try {
                // Check if content script is actually responding
                const isActive = await isContentScriptInjected(tabId);

                // If tab is marked as injected but not responding, remove it
                if (injectedTabs.has(tabId) && !isActive) {
                    console.log('Removing non-responsive tab from injected set:', tabId);
                    injectedTabs.delete(tabId);
                }

                // Inject content script if needed
                if (!isActive) {
                    console.log('Attempting to inject content script into tab:', tabId);
                    const success = await injectContentScript(tabId);

                    if (success) {
                        // Initialize page tracking if new tab
                        if (!tabsInfo.has(tabId)) {
                            currentPageCount++;
                            tabsInfo.set(tabId, {
                                pageNumber: currentPageCount,
                                url: tab.url
                            });

                            // Update storage
                            const tabsMapping = {};
                            for (const [key, value] of tabsInfo) {
                                tabsMapping[key] = value;
                            }
                            await chrome.storage.local.set({
                                pageCounter: currentPageCount,
                                tabsMapping: tabsMapping
                            });
                        }

                        // Add delay to ensure content script is ready
                        await new Promise(resolve => setTimeout(resolve, 100));

                        // Try to notify content script about recording state
                        try {
                            await chrome.tabs.sendMessage(tabId, {
                                action: 'toggleRecording',
                                isRecording: true
                            });
                            console.log('Successfully notified tab about recording state:', tabId);
                        } catch (error) {
                            console.log('Failed to notify tab, will retry on next update:', tabId);
                            injectedTabs.delete(tabId);
                        }
                    } else {
                        console.log('Failed to inject content script into tab:', tabId);
                    }
                } else {
                    // Content script is active, just update recording state
                    try {
                        await chrome.tabs.sendMessage(tabId, {
                            action: 'toggleRecording',
                            isRecording: true
                        });
                        console.log('Updated recording state for existing tab:', tabId);
                    } catch (error) {
                        console.log('Tab not responsive, removing from injected set:', tabId);
                        injectedTabs.delete(tabId);
                    }
                }
            } catch (error) {
                console.error('Error handling tab update:', error);
                // Clean up if needed
                if (injectedTabs.has(tabId)) {
                    injectedTabs.delete(tabId);
                }
            }
        }
    }
});

// Handle tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
    console.log('Tab removed:', tabId);
    tabsInfo.delete(tabId);
    injectedTabs.delete(tabId);
});

// Handle tab navigation
chrome.webNavigation?.onBeforeNavigate?.addListener((details) => {
    if (details.frameId === 0) { // Main frame only
        console.log('Tab navigating, cleaning up:', details.tabId);
        injectedTabs.delete(details.tabId);
    }
});

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle title update
    if (message.action === 'updateTitle') {
        if (message.isRecording) {
            chrome.action.setTitle({ title: 'Playwright Test Recorder (REC)' });
        } else {
            chrome.action.setTitle({ title: 'Playwright Test Recorder' });
        }
        return false;
    }

    // Handle ping message synchronously
    if (message.action === 'ping') {
        sendResponse({ status: 'pong' });
        return false;
    }

    // Handle page info request synchronously
    if (message.action === 'getPageInfo') {
        const tabId = sender.tab ? sender.tab.id : null;
        const pageInfo = tabId ? tabsInfo.get(tabId) : null;
        sendResponse({
            pageInfo: pageInfo || { pageNumber: 0 },
            currentUrl: sender.tab ? sender.tab.url : null
        });
        return false; // No async response needed
    }

    // Handle action recording synchronously
    if (message.type === 'actionRecorded' && sender.tab) {
        const tabId = sender.tab.id;
        const pageInfo = tabsInfo.get(tabId) || { pageNumber: 0 };

        try {
            // Get current recorded actions
            chrome.storage.local.get(['recordedActions'], function(result) {
                const currentActions = result.recordedActions || [];
                const newAction = {
                    ...message.action,
                    pageInfo: pageInfo,
                    url: sender.tab.url
                };

                // Add new action
                currentActions.push(newAction);

                // Update storage
                chrome.storage.local.set({ recordedActions: currentActions }, function() {
                    // Forward to popup
                    chrome.runtime.sendMessage({
                        type: 'actionRecorded',
                        source: 'background',
                        action: newAction
                    });
                });
            });
        } catch (error) {
            console.error('Error handling recorded action:', error);
        }

        sendResponse({ status: 'received' });
        return false; // No async response needed
    }

    // Handle recording toggle with async response
    if (message.action === 'toggleRecording') {
        handleRecordingToggle(message, sendResponse);
        return true; // Will send response asynchronously
    }

    return false; // No async response needed for other messages
});

// Separate function to handle recording toggle
async function handleRecordingToggle(message, sendResponse) {
    try {
        const tabId = message.tabId;

        // Validate tab
        const tab = await chrome.tabs.get(tabId);
        if (!tab) {
            console.error('Tab not found:', tabId);
            sendResponse({ status: 'error', message: 'Tab not found' });
            return;
        }

        isRecording = message.isRecording;

        if (isRecording) {
            // Reset counters and maps when starting new recording
            currentPageCount = 0;
            tabsInfo.clear();

            // Only inject if not already injected
            if (!injectedTabs.has(tabId)) {
                const success = await injectContentScript(tabId);
                if (!success) {
                    console.error('Failed to inject content script');
                    sendResponse({ status: 'error', message: 'Failed to inject content script' });
                    return;
                }
            }

            // Initialize page tracking
            currentPageCount++;
            tabsInfo.set(tabId, {
                pageNumber: currentPageCount,
                url: tab.url
            });

            // Notify content script
            await chrome.tabs.sendMessage(tabId, {
                action: 'toggleRecording',
                isRecording: true
            });
        } else {
            // Stop recording in all injected tabs
            for (const injectedTabId of injectedTabs) {
                try {
                    await chrome.tabs.sendMessage(injectedTabId, {
                        action: 'toggleRecording',
                        isRecording: false
                    });
                } catch (error) {
                    // If message fails, remove from injected set
                    injectedTabs.delete(injectedTabId);
                    console.log('Error stopping recording in tab:', injectedTabId, error);
                }
            }
        }

        console.log('Recording state changed successfully:', isRecording);
        sendResponse({ status: 'success' });
    } catch (error) {
        console.error('Error in toggleRecording:', error);
        sendResponse({ status: 'error', message: error.message });
    }
}

// Handle tab activation (switching between tabs)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tabId = activeInfo.tabId;

    try {
        const tab = await chrome.tabs.get(tabId);

        // Skip if URL is not valid for injection
        if (!isValidUrl(tab.url)) {
            console.log('Skipping recording for restricted page:', tab.url);
            return;
        }

        if (isRecording) {
            // Check if content script is responding
            const isActive = await isContentScriptInjected(tabId);

            // If marked as injected but not responding, remove from set
            if (injectedTabs.has(tabId) && !isActive) {
                console.log('Removing non-responsive tab from injected set on activation:', tabId);
                injectedTabs.delete(tabId);
            }

            // Inject if needed
            if (!isActive) {
                console.log('Injecting content script into newly activated tab:', tabId);
                const success = await injectContentScript(tabId);

                if (success) {
                    // Initialize page tracking if new tab
                    if (!tabsInfo.has(tabId)) {
                        currentPageCount++;
                        tabsInfo.set(tabId, {
                            pageNumber: currentPageCount,
                            url: tab.url
                        });

                        // Update storage
                        const tabsMapping = {};
                        for (const [key, value] of tabsInfo) {
                            tabsMapping[key] = value;
                        }
                        await chrome.storage.local.set({
                            pageCounter: currentPageCount,
                            tabsMapping: tabsMapping
                        });
                    }

                    // Add small delay to ensure content script is ready
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            // Update recording state in the tab
            try {
                await chrome.tabs.sendMessage(tabId, {
                    action: 'toggleRecording',
                    isRecording: true
                });
                console.log('Updated recording state for activated tab:', tabId);
            } catch (error) {
                console.log('Failed to update recording state on tab activation:', error);
                injectedTabs.delete(tabId);
            }
        }
    } catch (error) {
        console.error('Error handling tab activation:', error);
    }
});

// Handle window focus change
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        console.log('All windows lost focus');
        return;
    }

    try {
        // Get the active tab in the focused window
        const [activeTab] = await chrome.tabs.query({ active: true, windowId });
        if (!activeTab) return;

        // Skip if URL is not valid for injection
        if (!isValidUrl(activeTab.url)) {
            console.log('Skipping recording for restricted page on window focus:', activeTab.url);
            return;
        }

        if (isRecording) {
            const tabId = activeTab.id;
            const isActive = await isContentScriptInjected(tabId);

            if (injectedTabs.has(tabId) && !isActive) {
                console.log('Removing non-responsive tab from injected set on window focus:', tabId);
                injectedTabs.delete(tabId);
            }

            if (!isActive) {
                console.log('Injecting content script into newly focused window tab:', tabId);
                const success = await injectContentScript(tabId);

                if (success) {
                    if (!tabsInfo.has(tabId)) {
                        currentPageCount++;
                        tabsInfo.set(tabId, {
                            pageNumber: currentPageCount,
                            url: activeTab.url
                        });

                        const tabsMapping = {};
                        for (const [key, value] of tabsInfo) {
                            tabsMapping[key] = value;
                        }
                        await chrome.storage.local.set({
                            pageCounter: currentPageCount,
                            tabsMapping: tabsMapping
                        });
                    }

                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            try {
                await chrome.tabs.sendMessage(tabId, {
                    action: 'toggleRecording',
                    isRecording: true
                });
                console.log('Updated recording state for focused window tab:', tabId);
            } catch (error) {
                console.log('Failed to update recording state on window focus:', error);
                injectedTabs.delete(tabId);
            }
        }
    } catch (error) {
        console.error('Error handling window focus change:', error);
    }
});
