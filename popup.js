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
            const { prevData, currentData } = await fetchPreviousTimecardFromPage(tab.id);
            await chrome.tabs.sendMessage(tab.id, { action: 'showPreviousTimecardData', prevData, currentData });
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

// Runs a self-contained async function in the page's MAIN world so that Oracle's
// own fetch middleware (which injects the Bearer token) is active when we call fetch().
async function fetchPreviousTimecardFromPage(tabId) {
    const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async () => {
            const headers = { accept: 'application/json', 'accept-language': 'en' };

            // Track URLs fetched by this extension so findLast doesn't pick them up
            // on subsequent clicks and keep going further back each time.
            if (!window.__ote_fetchedUrls) window.__ote_fetchedUrls = new Set();

            // Find any timeCardEntryDetails request Oracle already made for this page,
            // excluding URLs our extension has fetched.
            const entry = performance.getEntriesByType('resource')
                .findLast(e => e.name.includes('/timeCardEntryDetails') && !window.__ote_fetchedUrls.has(e.name));
            if (!entry) {
                return { error: 'API URL not found. Please reload the timecard page and try again.' };
            }

            const currentUrl = new URL(entry.name);
            const finder = currentUrl.searchParams.get('finder') || '';
            const asOfDateMatch = finder.match(/AsOfDate=([^,&]+)/);

            // Always fetch the current timecard data first
            const currentResp = await fetch(entry.name, { credentials: 'include', headers });
            if (!currentResp.ok) return { error: `Could not read current timecard: API returned ${currentResp.status}` };
            const currentData = await currentResp.json();

            let prevUrl;

            if (asOfDateMatch) {
                // Fast path: AsOfDate is already in the URL — shift back 20 days
                const d = new Date(asOfDateMatch[1]);
                d.setDate(d.getDate() - 20);
                const newDate = d.toISOString().slice(0, 10) + 'T00:00:00';
                currentUrl.searchParams.set('finder', finder.replace(/AsOfDate=[^,&]+/, `AsOfDate=${newDate}`));
                prevUrl = currentUrl.toString();
            } else {
                // Slow path: use the already-fetched current data to get StartDate and PersonId,
                // then build a findByPersonIdAndDate URL for the previous period.
                const item = currentData?.items?.[0];
                const startDate = item?.StartDate?.slice(0, 10);
                const personId = item?.PersonId;

                if (!startDate || !personId) {
                    return { error: 'Could not read period start date from current timecard.' };
                }

                // 1 day before the period start lands safely in the prior period
                const d = new Date(startDate);
                d.setDate(d.getDate() - 1);
                const prevDate = d.toISOString().slice(0, 10) + 'T00:00:00';

                // Build a findByPersonIdAndDate URL using the same API base path
                const base = new URL(entry.name);
                base.pathname = base.pathname.split('/timeCardEntryDetails')[0] + '/timeCardEntryDetails';
                base.search = '';
                base.searchParams.set('expand', [
                    'timeCardLayouts', 'timeCards', 'timeCardLayouts.timeCardFields',
                    'timeCards.publicHolidays', 'timeCards.timeEntries', 'timeCards.approvalTasks',
                    'timeCards.timeEntries.timeCardFieldValues', 'timeCards.emptyEntries',
                    'timeCards.emptyEntries.timeCardFieldValues', 'timeCards.messages',
                    'timeCards.timeEntries.messages', 'timeCards.scheduledHours',
                    'timeCards.changeRequests', 'timeCards.timeEntries.changeRequests'
                ].join(','));
                base.searchParams.set('finder', `findByPersonIdAndDate;UserContext=WORKER,PersonId=${personId},AsOfDate=${prevDate}`);
                base.searchParams.set('limit', '5000');
                base.searchParams.set('onlyData', 'true');
                prevUrl = base.toString();
            }

            window.__ote_fetchedUrls.add(prevUrl);
            const r = await fetch(prevUrl, { credentials: 'include', headers });
            if (!r.ok) return { error: `API returned ${r.status}` };
            return { prevData: await r.json(), currentData };
        }
    });

    if (result.result?.error) throw new Error(result.result.error);
    if (!result.result?.prevData) throw new Error('No data returned from API.');
    return result.result;
}