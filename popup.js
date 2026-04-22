// Popup script for managing enhancements
document.addEventListener('DOMContentLoaded', async () => {
    const loadingEl = document.getElementById('loading');
    const enhancementsEl = document.getElementById('enhancements');
    const optionsLink = document.getElementById('optionsLink');

    try {
        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Check if we're on a timecard page
        if (!tab.url.includes('oraclecloud.com') || !tab.url.includes('timecards')) {
        loadingEl.textContent = 'Navigate to your Oracle timecard to use this extension.';
        return;
        }

        // Get enhancements from content script
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getEnhancements' });
        
        if (!response || !response.enhancements) {
        loadingEl.textContent = 'Failed to load enhancements. Please refresh the page.';
        return;
        }

        // Hide loading and show actions + enhancements
        loadingEl.style.display = 'none';
        document.getElementById('actions').style.display = 'block';
        enhancementsEl.style.display = 'block';

        // Render enhancements
        renderEnhancements(response.enhancements);

        // Wire up previous timecard button
        const prevBtn = document.getElementById('showPrevTimecard');
        prevBtn.addEventListener('click', async () => {
          prevBtn.disabled = true;
          prevBtn.textContent = 'Loading…';
          try {
            const data = await fetchPreviousTimecardFromPage(tab.id);
            await chrome.tabs.sendMessage(tab.id, { action: 'showPreviousTimecardData', data });
            window.close();
          } catch (err) {
            prevBtn.textContent = '← Show Previous Timecard';
            prevBtn.disabled = false;
            alert(`Could not load previous timecard: ${err.message}`);
          }
        });

    } catch (error) {
        console.error('Error loading popup:', error);
        loadingEl.textContent = 'Error loading enhancements. Please refresh the page.';
    }

    // Options link
    optionsLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });
});

function renderEnhancements(enhancements) {
    const enhancementsEl = document.getElementById('enhancements');
    
    enhancements.forEach(enhancement => {
        const enhancementEl = createEnhancementElement(enhancement);
        enhancementsEl.appendChild(enhancementEl);
    });
}

function createEnhancementElement(enhancement) {
    const div = document.createElement('div');
    div.className = 'enhancement';
    
    div.innerHTML = `
        <div class="enhancement-info">
        <div class="enhancement-name">${formatEnhancementName(enhancement.name)}</div>
        <div class="enhancement-description">${enhancement.description}</div>
        </div>
        <div class="toggle-switch ${enhancement.enabled ? 'enabled' : ''}" data-name="${enhancement.name}" data-enabled="${enhancement.enabled}"></div>
    `;

    // Add click handler for toggle
    const toggle = div.querySelector('.toggle-switch');
    toggle.addEventListener('click', () => {
        const currentEnabled = toggle.dataset.enabled === 'true';
        toggleEnhancement(enhancement.name, !currentEnabled, toggle);
    });

    return div;
}

function formatEnhancementName(name) {
    return name
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

async function toggleEnhancement(name, enabled, toggleEl) {
    try {
        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Send toggle message to content script
        const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'toggleEnhancement',
        name: name,
        enabled: enabled
        });

        if (response && response.success) {
        // Update UI
        if (enabled) {
            toggleEl.classList.add('enabled');
        } else {
            toggleEl.classList.remove('enabled');
        }
        
        // Update the data attribute to track current state
        toggleEl.dataset.enabled = enabled.toString();
        } else {
        console.error('Failed to toggle enhancement:', response?.error);
        alert('Failed to toggle enhancement. Please try again.');
        }
    } catch (error) {
        console.error('Error toggling enhancement:', error);
        alert('Error toggling enhancement. Please refresh the page and try again.');
    }
}

// Runs a self-contained function in the page's MAIN world so that Oracle's own
// fetch middleware (which injects the Bearer token) is active when we call fetch().
async function fetchPreviousTimecardFromPage(tabId) {
    const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
            // Find the timeCardEntryDetails URL Oracle already fetched for this page
            const entry = performance.getEntriesByType('resource')
                .find(e => e.name.includes('/timeCardEntryDetails?'));
            if (!entry) {
                return { error: 'API URL not found. Please reload the timecard page and try again.' };
            }

            const url = new URL(entry.name);
            const finder = url.searchParams.get('finder');
            const match = finder && finder.match(/AsOfDate=([^,&]+)/);
            if (!match) {
                return { error: 'Could not parse AsOfDate from API URL.' };
            }

            // Shift back 20 days — safely lands in the prior semi-monthly period
            const d = new Date(match[1]);
            d.setDate(d.getDate() - 20);
            const newAsOfDate = d.toISOString().slice(0, 10) + 'T00:00:00';
            url.searchParams.set('finder', finder.replace(/AsOfDate=[^,&]+/, `AsOfDate=${newAsOfDate}`));

            // Calling window.fetch here goes through Oracle's own auth middleware,
            // which adds the Authorization: Bearer header automatically.
            return fetch(url.toString(), {
                credentials: 'include',
                headers: { accept: 'application/json', 'accept-language': 'en' }
            })
                .then(r => r.ok ? r.json().then(data => ({ data })) : { error: `API returned ${r.status}` })
                .catch(err => ({ error: err.message }));
        }
    });

    if (result.result?.error) throw new Error(result.result.error);
    if (!result.result?.data) throw new Error('No data returned from API.');
    return result.result.data;
}