# Last 12 Months Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Last 12 Months" tab to the Previous Timecard modal that lazily fetches ~24 pay periods, aggregates them into 12 calendar-month columns, and displays them in a wide sticky-column table.

**Architecture:** The modal gains two tabs. When "Last 12 Months" is clicked for the first time, the content script triggers a MAIN world fetch helper (injected by popup.js before it closes) via `window.postMessage`. The helper walks backwards ~24 pay periods, posting progress updates. The content script receives these, aggregates periods into months, and renders the table.

**Tech Stack:** Vanilla JS (ES2020), Chrome Extension MV3, no build tooling, no test framework — verification steps use the browser console and manual extension reload.

---

## File Map

| File | Changes |
|------|---------|
| `popup.js` | Add `injectFetch12MonthsHelper(tabId, currentData)` call before `window.close()` |
| `src/enhancements/previous-timecard.js` | Add tab UI, `buildMonthRows()`, `fmtMonthLabel()`, `showLoadingState()`, `updateProgress()`, `render12MonthTable()`, modal width toggle, message listener |

---

## Task 1: Add tab UI to modal HTML and CSS

**Files:**
- Modify: `src/enhancements/previous-timecard.js`

### Context

`showModal()` currently builds a single flat dialog with a header div (`#ote-prev-header`) and a body div (`#ote-prev-body`). We need to:
1. Insert a tab bar between the header and body
2. Wrap the existing body content in a tab panel (`ote-panel-prev-cur`)
3. Add an empty second tab panel (`ote-panel-last-12`) initially hidden
4. Wire up tab-switching click handlers

- [ ] **Step 1: Add the tab bar HTML inside `showModal()`**

In `showModal()`, find the line that reads:
```javascript
        <div id="ote-prev-body">
```

Replace the entire `modal.innerHTML` assignment. The new version adds `id="ote-tabs"` between the header and the body, and wraps the existing table in `id="ote-panel-prev-cur"`. The second panel `id="ote-panel-last-12"` is empty for now.

Replace the `modal.innerHTML = \`...\`` block (lines 103–154 of `previous-timecard.js`) with:

```javascript
    modal.innerHTML = `
      <div id="ote-prev-overlay"></div>
      <div id="ote-prev-dialog" role="dialog" aria-modal="true">
        <div id="ote-prev-header">
          <div>
            <h2>Timecard Summary</h2>
            <span id="ote-prev-period">Pay period comparison</span>
          </div>
          <button id="ote-prev-close" title="Close">&#x2715;</button>
        </div>
        <div id="ote-tabs">
          <button class="ote-tab ote-tab-active" data-tab="prev-cur">Previous vs Current</button>
          <button class="ote-tab" data-tab="last-12">Last 12 Months</button>
        </div>
        <div id="ote-panel-prev-cur" class="ote-panel">
          <div id="ote-prev-body">
            <table id="ote-prev-table">
              <thead>
                <tr>
                  <th class="ote-text-col ote-th">
                    <div class="ote-th-inner ote-th-left">Project</div>
                  </th>
                  <th class="ote-text-col ote-th">
                    <div class="ote-th-inner ote-th-left">Task</div>
                  </th>
                  <th class="ote-th">
                    <div class="ote-th-inner">
                      <span>Previous</span>
                      <span class="ote-th-date">${prevRange}</span>
                    </div>
                  </th>
                  <th class="ote-th ote-cur-head">
                    <div class="ote-th-inner">
                      <span class="ote-cur-label">Current</span>
                      <span class="ote-th-date">${curRange}</span>
                    </div>
                  </th>
                  <th class="ote-th">
                    <div class="ote-th-inner">
                      <span>Combined</span>
                      <span class="ote-th-date">Both periods</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
              <tfoot>
                <tr>
                  <td class="ote-text-col ote-total-cell" colspan="2"><strong>Total</strong></td>
                  <td class="ote-num-col ote-total-cell"><strong>${this.fmt(prevTotal)}</strong></td>
                  <td class="ote-num-col ote-total-cell ote-cur-col"><strong>${this.fmt(curTotal)}</strong></td>
                  <td class="ote-num-col ote-total-cell ote-combined"><strong>${this.fmt(combTotal)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <div id="ote-panel-last-12" class="ote-panel" style="display:none"></div>
      </div>`;
```

- [ ] **Step 2: Add tab and panel CSS to the style block**

Inside `style.textContent = \`...\`` (after the existing `.ote-empty` rule, before the closing backtick), append:

```css
      #ote-tabs {
        display: flex;
        border-bottom: 2px solid #e5e7eb;
        background: #f5f6f8;
        padding: 0 22px;
      }
      .ote-tab {
        background: none; border: none; cursor: pointer;
        padding: 10px 16px;
        font-size: 13px; font-weight: 500; color: #6b7280;
        border-bottom: 2px solid transparent;
        margin-bottom: -2px;
        transition: color 0.15s;
      }
      .ote-tab:hover { color: #1f2328; }
      .ote-tab.ote-tab-active {
        color: #1f2328; font-weight: 600;
        border-bottom-color: #3c4a5c;
      }
      .ote-panel { display: block; }
      #ote-panel-last-12 {
        max-height: 65vh;
        overflow-y: auto;
      }
```

- [ ] **Step 3: Wire up tab-switching after the modal is inserted into the DOM**

After the line `document.getElementById('ote-prev-close').addEventListener(...)` in `showModal()`, add:

```javascript
    document.querySelectorAll('.ote-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.ote-tab').forEach(t => t.classList.remove('ote-tab-active'));
        tab.classList.add('ote-tab-active');
        const panel = tab.dataset.tab;
        const dialog = document.getElementById('ote-prev-dialog');
        document.getElementById('ote-panel-prev-cur').style.display = panel === 'prev-cur' ? '' : 'none';
        document.getElementById('ote-panel-last-12').style.display = panel === 'last-12' ? '' : 'none';
        dialog.classList.toggle('ote-dialog-wide', panel === 'last-12');
        if (panel === 'last-12') this._onLast12TabActivated();
      });
    });
```

- [ ] **Step 4: Add stub for `_onLast12TabActivated`**

Add this method to the class (after `showError`, before the closing `}`):

```javascript
  _onLast12TabActivated() {
    // Lazy fetch — implemented in Task 4
  }
```

- [ ] **Step 5: Reload the extension and verify**

1. Go to `chrome://extensions`, click the reload icon for Oracle Timecard Enhancements
2. Navigate to your Oracle timecard page
3. Click "← Show Previous Timecard" in the extension popup
4. Verify: two tabs appear ("Previous vs Current" and "Last 12 Months")
5. Verify: clicking "Last 12 Months" shows the empty panel; clicking back shows the table
6. Verify: existing "Previous vs Current" table still displays correctly

- [ ] **Step 6: Commit**

```bash
git add src/enhancements/previous-timecard.js
git commit -m "feat: add tab UI to Previous Timecard modal"
```

---

## Task 2: Inject 12-month fetch helper from popup.js

**Files:**
- Modify: `popup.js`

### Context

When the user clicks "← Show Previous Timecard", popup.js fetches the previous period data, sends it to the content script, then calls `window.close()`. Before closing, we inject a persistent MAIN world listener function via `chrome.scripting.executeScript`. This listener waits for a `window.postMessage({ type: 'ote-fetch-12m', ... })` from the content script, then walks back ~24 pay periods and posts progress/results back.

The content script cannot use `chrome.scripting.executeScript` (only popup and background scripts can). This MAIN world injection is the bridge.

- [ ] **Step 1: Add `injectFetch12MonthsHelper` function to popup.js**

Append this function at the end of `popup.js` (after `fetchPreviousTimecardFromPage`):

```javascript
async function injectFetch12MonthsHelper(tabId, currentData) {
  const item = currentData?.items?.[0];
  const startDate = item?.StartDate?.slice(0, 10);
  const personId = item?.PersonId;
  if (!startDate || !personId) return; // can't inject without these

  // Build the API base URL from the most recent timeCardEntryDetails resource entry
  // so the helper knows which host/path to use for subsequent fetches.
  const [urlResult] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const entry = performance.getEntriesByType('resource')
        .findLast(e => e.name.includes('/timeCardEntryDetails'));
      if (!entry) return null;
      const u = new URL(entry.name);
      return u.origin + u.pathname.split('/timeCardEntryDetails')[0] + '/timeCardEntryDetails';
    }
  });
  const baseUrl = urlResult?.result;
  if (!baseUrl) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (baseUrl, personId, startDate) => {
      if (window.__ote_12m_injected) return;
      window.__ote_12m_injected = true;

      const TOTAL = 24;
      const headers = { accept: 'application/json', 'accept-language': 'en' };

      function buildPeriodUrl(personId, asOfDate) {
        const base = new URL(baseUrl);
        base.searchParams.set('expand', [
          'timeCardLayouts', 'timeCards', 'timeCardLayouts.timeCardFields',
          'timeCards.publicHolidays', 'timeCards.timeEntries', 'timeCards.approvalTasks',
          'timeCards.timeEntries.timeCardFieldValues', 'timeCards.emptyEntries',
          'timeCards.emptyEntries.timeCardFieldValues', 'timeCards.messages',
          'timeCards.timeEntries.messages', 'timeCards.scheduledHours',
          'timeCards.changeRequests', 'timeCards.timeEntries.changeRequests'
        ].join(','));
        base.searchParams.set('finder', `findByPersonIdAndDate;UserContext=WORKER,PersonId=${personId},AsOfDate=${asOfDate}`);
        base.searchParams.set('limit', '5000');
        base.searchParams.set('onlyData', 'true');
        return base.toString();
      }

      window.addEventListener('message', async (event) => {
        if (event.source !== window || event.data?.type !== 'ote-fetch-12m') return;

        const periods = [];
        let currentStart = event.data.startDate;

        try {
          for (let i = 0; i < TOTAL; i++) {
            const d = new Date(currentStart);
            d.setDate(d.getDate() - 1);
            const asOfDate = d.toISOString().slice(0, 10) + 'T00:00:00';
            const url = buildPeriodUrl(event.data.personId, asOfDate);

            const resp = await fetch(url, { credentials: 'include', headers });
            if (!resp.ok) throw new Error(`API returned ${resp.status} on period ${i + 1}`);
            const data = await resp.json();

            const periodItem = data?.items?.[0];
            if (!periodItem) break; // no more history

            const pStart = periodItem.StartDate?.slice(0, 10);
            periods.push({ data, startDate: pStart });
            currentStart = pStart;

            window.postMessage({ type: 'ote-12m-progress', done: i + 1, total: TOTAL }, '*');
          }
          window.postMessage({ type: 'ote-12m-done', periods }, '*');
        } catch (err) {
          window.postMessage({ type: 'ote-12m-error', periods, message: err.message }, '*');
        }
      });
    },
    args: [baseUrl, personId, startDate]
  });
}
```

- [ ] **Step 2: Call `injectFetch12MonthsHelper` before `window.close()`**

In the `prevBtn` click handler, replace:

```javascript
            await chrome.tabs.sendMessage(tab.id, { action: 'showPreviousTimecardData', prevData, currentData });
            window.close();
```

with:

```javascript
            await chrome.tabs.sendMessage(tab.id, { action: 'showPreviousTimecardData', prevData, currentData });
            await injectFetch12MonthsHelper(tab.id, currentData);
            window.close();
```

- [ ] **Step 3: Verify the injection works**

1. Reload the extension
2. Open the Oracle timecard, click "← Show Previous Timecard"
3. After the modal opens, open DevTools console on the timecard page
4. Run: `window.__ote_12m_injected`
5. Expected: `true`
6. Run: `window.postMessage({ type: 'ote-fetch-12m', personId: 'test', startDate: '2025-05-01' }, '*')` — this will fail gracefully with an API error, but you should see a `postMessage` event in the console, confirming the listener is active

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "feat: inject 12-month MAIN world fetch helper from popup"
```

---

## Task 3: Add month aggregation logic

**Files:**
- Modify: `src/enhancements/previous-timecard.js`

### Context

`buildMonthRows` takes an array of `{ data, startDate }` period objects (from the MAIN world helper) and returns aggregated data grouped by calendar month. `fmtMonthLabel` converts a `"YYYY-MM"` key to the display string `"Jun '24"`.

- [ ] **Step 1: Add `fmtMonthLabel` method**

Add after the existing `fmt(n)` method:

```javascript
  fmtMonthLabel(key) {
    const [year, month] = key.split('-');
    const d = new Date(parseInt(year), parseInt(month) - 1, 1);
    return d.toLocaleString('en-US', { month: 'short' }) + " '" + year.slice(2);
  }
```

- [ ] **Step 2: Verify `fmtMonthLabel` in the console**

Reload the extension, open the timecard page, open DevTools console. Run:

```javascript
const e = window._previousTimecardEnhancement;
console.assert(e.fmtMonthLabel('2024-06') === "Jun '24", 'June 2024');
console.assert(e.fmtMonthLabel('2025-01') === "Jan '25", 'Jan 2025');
console.assert(e.fmtMonthLabel('2024-12') === "Dec '24", 'Dec 2024');
console.log('fmtMonthLabel ok');
```

Expected: `fmtMonthLabel ok` with no assertion errors.

- [ ] **Step 3: Add `buildMonthRows` method**

Add after `fmtMonthLabel`:

```javascript
  buildMonthRows(periods) {
    // Group pay periods by calendar month (YYYY-MM) using the period's StartDate
    const monthMap = new Map(); // "YYYY-MM" -> Map("project\0task" -> hours)

    for (const { data, startDate } of periods) {
      const monthKey = startDate ? startDate.slice(0, 7) : null;
      if (!monthKey) continue;

      const totals = this.parseTotalsMap(data);
      if (!monthMap.has(monthKey)) monthMap.set(monthKey, new Map());
      const month = monthMap.get(monthKey);

      for (const [key, hours] of totals) {
        month.set(key, (month.get(key) || 0) + hours);
      }
    }

    // Sort months oldest → newest
    const sortedKeys = Array.from(monthMap.keys()).sort();

    // Build unified set of all project/task keys across all months
    const allKeys = new Set();
    for (const totals of monthMap.values()) {
      for (const key of totals.keys()) allKeys.add(key);
    }

    // Build rows: one per project/task combo
    const rows = Array.from(allKeys)
      .map(key => {
        const [project, task] = key.split('\0');
        const monthHours = sortedKeys.map(mk => monthMap.get(mk)?.get(key) || 0);
        return { project, task, monthHours };
      })
      .sort((a, b) => a.project.localeCompare(b.project) || a.task.localeCompare(b.task));

    return {
      monthKeys: sortedKeys,
      monthLabels: sortedKeys.map(k => this.fmtMonthLabel(k)),
      rows
    };
  }
```

- [ ] **Step 4: Verify `buildMonthRows` in the console**

After reloading the extension and opening the modal, run in DevTools:

```javascript
const e = window._previousTimecardEnhancement;

// Simulate two periods in the same month and one in another
const mockData = (project, task, hours) => ({
  items: [{
    StartDate: '2024-06-01',
    timeCardLayouts: { items: [{ timeCardFields: { items: [
      { Label: 'Project', TimeCardFieldId: 'P' },
      { Label: 'Task',    TimeCardFieldId: 'T' }
    ]}}]},
    timeCards: { items: [{ timeEntries: { items: [
      { Measure: hours, timeCardFieldValues: { items: [
        { TimeCardFieldId: 'P', DisplayValue: project },
        { TimeCardFieldId: 'T', DisplayValue: task }
      ]}}
    ]}}]}
  }]
});

const p1 = { data: mockData('Alpha', 'Dev', 20), startDate: '2024-06-01' };
const p2 = { data: mockData('Alpha', 'Dev', 18), startDate: '2024-06-15' };
const p3 = { data: mockData('Alpha', 'Dev', 22), startDate: '2024-07-01' };

const result = e.buildMonthRows([p1, p2, p3]);
console.assert(result.monthKeys.length === 2, 'two months');
console.assert(result.monthKeys[0] === '2024-06', 'first month June');
console.assert(result.rows[0].monthHours[0] === 38, 'June: 20+18=38');
console.assert(result.rows[0].monthHours[1] === 22, 'July: 22');
console.assert(result.monthLabels[0] === "Jun '24", 'label');
console.log('buildMonthRows ok');
```

Expected: `buildMonthRows ok` with no assertion errors.

- [ ] **Step 5: Commit**

```bash
git add src/enhancements/previous-timecard.js
git commit -m "feat: add buildMonthRows and fmtMonthLabel for 12-month aggregation"
```

---

## Task 4: Wire up lazy fetch trigger, progress bar, and result handling

**Files:**
- Modify: `src/enhancements/previous-timecard.js`

### Context

When "Last 12 Months" is activated for the first time:
1. Show a progress bar in `#ote-panel-last-12`
2. Send `window.postMessage({ type: 'ote-fetch-12m', personId, startDate })` to trigger the MAIN world helper
3. Listen for `ote-12m-progress` → update bar
4. Listen for `ote-12m-done` or `ote-12m-error` → render table or partial table + warning

`showModal` receives `currentData` which contains the `PersonId` and `StartDate` needed to trigger the fetch.

- [ ] **Step 1: Store personId and startDate as instance variables in `showModal`**

After the line `const curRange = ...` near the top of `showModal`, add:

```javascript
    this._12mPersonId  = curItem?.PersonId  || null;
    this._12mStartDate = curItem?.StartDate?.slice(0, 10) || null;
    this._12mLoaded    = false;
    this._12mMsgHandler = null;
```

- [ ] **Step 2: Add `showLoadingState` method**

Add after `_onLast12TabActivated`:

```javascript
  showLoadingState() {
    document.getElementById('ote-panel-last-12').innerHTML = `
      <div id="ote-12m-loading" style="padding: 32px 22px; text-align: center;">
        <div style="color: #4b5563; margin-bottom: 12px; font-size: 14px;">
          Fetching historical data&hellip; <strong><span id="ote-12m-done">0</span> / <span id="ote-12m-total">24</span></strong>
        </div>
        <div style="background: #e5e7eb; border-radius: 4px; height: 8px; overflow: hidden;">
          <div id="ote-12m-bar" style="background: #3c4a5c; width: 0%; height: 100%; transition: width 0.25s;"></div>
        </div>
        <div style="color: #9aa0a6; font-size: 12px; margin-top: 10px;">This may take a few seconds</div>
      </div>`;
  }
```

- [ ] **Step 3: Add `updateProgress` method**

```javascript
  updateProgress(done, total) {
    const doneEl  = document.getElementById('ote-12m-done');
    const barEl   = document.getElementById('ote-12m-bar');
    const totalEl = document.getElementById('ote-12m-total');
    if (!doneEl) return;
    doneEl.textContent  = done;
    totalEl.textContent = total;
    barEl.style.width   = Math.round((done / total) * 100) + '%';
  }
```

- [ ] **Step 4: Implement `_onLast12TabActivated`**

Replace the stub from Task 1:

```javascript
  _onLast12TabActivated() {
    if (this._12mLoaded) return; // already fetched this session
    if (!this._12mPersonId || !this._12mStartDate) {
      document.getElementById('ote-panel-last-12').innerHTML =
        '<p style="padding:24px;color:#9aa0a6;text-align:center;">Could not determine person or period — please reload the timecard.</p>';
      return;
    }

    this.showLoadingState();

    // Dialog width is toggled by the tab switcher in showModal — no change needed here

    this._12mMsgHandler = (event) => {
      if (event.source !== window) return;
      const { type, done, total, periods, message } = event.data || {};

      if (type === 'ote-12m-progress') {
        this.updateProgress(done, total);

      } else if (type === 'ote-12m-done' || type === 'ote-12m-error') {
        window.removeEventListener('message', this._12mMsgHandler);
        this._12mMsgHandler = null;
        this._12mLoaded = true;

        const monthData = this.buildMonthRows(periods || []);
        this.render12MonthTable(monthData, type === 'ote-12m-error' ? message : null);
      }
    };

    window.addEventListener('message', this._12mMsgHandler);
    window.postMessage({ type: 'ote-fetch-12m', personId: this._12mPersonId, startDate: this._12mStartDate }, '*');
  }
```

- [ ] **Step 5: Clean up the message handler in `closeModal`**

In `closeModal()`, after the existing cleanup code, add:

```javascript
    if (this._12mMsgHandler) {
      window.removeEventListener('message', this._12mMsgHandler);
      this._12mMsgHandler = null;
    }
```

- [ ] **Step 6: Add `.ote-dialog-wide` CSS rule to the style block**

In `style.textContent`, after the existing `#ote-prev-dialog` rule, add:

```css
      #ote-prev-dialog.ote-dialog-wide {
        max-width: min(95vw, 1600px);
        width: 95vw;
      }
```

- [ ] **Step 7: Reload and verify the loading state**

1. Reload the extension
2. Open the modal, click "Last 12 Months"
3. Expected: progress bar appears, counter increments from 0/24 upward
4. Expected: modal widens when the tab is activated
5. If the MAIN world helper was not injected (e.g., you opened the modal before completing Task 2), you will see the loading bar but nothing will happen — that is expected at this stage

- [ ] **Step 8: Commit**

```bash
git add src/enhancements/previous-timecard.js
git commit -m "feat: add lazy fetch trigger and progress bar for 12-month tab"
```

---

## Task 5: Render 12-month table

**Files:**
- Modify: `src/enhancements/previous-timecard.js`

### Context

`render12MonthTable` receives the output of `buildMonthRows` and an optional `errorMsg`. It builds a wide table with sticky Project and Task columns, 12 month columns (oldest → newest), the most recent month highlighted green, empty cells showing `—`, and a totals row.

The sticky column widths are fixed (`left: 0` for Project, `left: 140px` for Task) — adjust if long project names need more space.

- [ ] **Step 1: Add `render12MonthTable` method**

Add after `updateProgress`:

```javascript
  render12MonthTable({ monthKeys, monthLabels, rows }, errorMsg) {
    const panel = document.getElementById('ote-panel-last-12');
    if (!panel) return;

    // Compute per-month totals
    const monthTotals = monthKeys.map((_, mi) =>
      rows.reduce((sum, r) => sum + r.monthHours[mi], 0)
    );

    const currentMonthIdx = monthKeys.length - 1;

    // Build header cells for each month
    const monthHeaders = monthLabels.map((label, i) => {
      const isCurrent = i === currentMonthIdx;
      return `<th class="ote-th ote-12m-num-th${isCurrent ? ' ote-12m-cur-month' : ''}">${label}</th>`;
    }).join('');

    // Build data rows
    const dataRows = rows.length
      ? rows.map((r, ri) => {
          const cells = r.monthHours.map((h, i) => {
            const isCurrent = i === currentMonthIdx;
            return `<td class="ote-num-col${isCurrent ? ' ote-12m-cur-month' : ''}">${h > 0 ? this.fmt(h) : '—'}</td>`;
          }).join('');
          return `<tr class="${ri % 2 === 1 ? 'ote-alt' : ''}">
            <td class="ote-text-col ote-sticky-proj">${r.project}</td>
            <td class="ote-text-col ote-sticky-task">${r.task}</td>
            ${cells}
          </tr>`;
        }).join('')
      : `<tr><td colspan="${2 + monthKeys.length}" class="ote-empty">No entries found</td></tr>`;

    // Build totals row
    const totalCells = monthTotals.map((t, i) => {
      const isCurrent = i === currentMonthIdx;
      return `<td class="ote-num-col ote-total-cell ote-12m-monospace${isCurrent ? ' ote-12m-cur-month' : ''}"><strong>${this.fmt(t)}</strong></td>`;
    }).join('');

    const warningHtml = errorMsg
      ? `<div style="padding: 8px 22px; background: #fff3cd; color: #856404; font-size: 12px; border-bottom: 1px solid #e5e7eb;">
           ⚠ Could not load all 12 months — showing ${monthKeys.length} month${monthKeys.length !== 1 ? 's' : ''} retrieved. (${errorMsg})
         </div>`
      : '';

    panel.innerHTML = `
      ${warningHtml}
      <div style="overflow-x: auto; max-height: 65vh; overflow-y: auto;">
        <table class="ote-12m-table" style="width: 100%; border-collapse: collapse; white-space: nowrap;">
          <thead>
            <tr>
              <th class="ote-text-col ote-th ote-sticky-proj" style="text-align:left;">Project</th>
              <th class="ote-text-col ote-th ote-sticky-task" style="text-align:left;">Task</th>
              ${monthHeaders}
            </tr>
          </thead>
          <tbody>${dataRows}</tbody>
          <tfoot>
            <tr>
              <td class="ote-text-col ote-total-cell ote-sticky-proj" colspan="2"><strong>Total</strong></td>
              ${totalCells}
            </tr>
          </tfoot>
        </table>
      </div>`;
  }
```

- [ ] **Step 2: Add sticky column and 12-month table CSS to the style block**

Append after the `.ote-dialog-wide` rule:

```css
      .ote-sticky-proj {
        position: sticky; left: 0; z-index: 1;
        background: inherit;
        min-width: 140px; max-width: 200px;
        border-right: 1px solid #e5e7eb;
      }
      .ote-sticky-task {
        position: sticky; left: 140px; z-index: 1;
        background: inherit;
        min-width: 120px; max-width: 180px;
        border-right: 1px solid #e5e7eb;
      }
      .ote-12m-table thead .ote-sticky-proj,
      .ote-12m-table thead .ote-sticky-task {
        z-index: 2;
        background: #f5f6f8;
      }
      .ote-12m-table tfoot .ote-sticky-proj {
        background: #fafbfc;
      }
      .ote-12m-num-th {
        text-align: right;
        padding: 10px 10px;
        font-size: 12px; font-weight: 600; color: #4b5563;
        background: #f5f6f8;
        border-bottom: 1px solid #e5e7eb;
        white-space: nowrap;
      }
      .ote-12m-cur-month {
        background: #f0faf0 !important;
        color: #166534;
      }
      .ote-12m-table td {
        padding: 10px 10px;
        font-size: 13px;
        border-bottom: 1px solid #eef0f3;
      }
      .ote-12m-table tbody tr.ote-alt td { background: #fafbfc; }
      .ote-12m-table tbody tr:hover td { background: #f0f6ff; }
      .ote-12m-monospace {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-variant-numeric: tabular-nums;
      }
```

- [ ] **Step 3: End-to-end manual test**

1. Reload the extension
2. Navigate to your Oracle timecard and click "← Show Previous Timecard"
3. Modal opens on "Previous vs Current" tab — verify it looks identical to before
4. Click "Last 12 Months" tab:
   - Expected: modal widens, progress bar appears and increments
   - After ~10–20 seconds: table renders with 12 month columns
   - Current month column is green-tinted
   - Months with no hours show `—`
   - Totals row at the bottom
   - Horizontal scroll available if columns overflow
   - Project and Task columns stay fixed when scrolling horizontally
5. Switch back to "Previous vs Current" — modal narrows, existing table is unchanged
6. Click "Last 12 Months" again — table appears instantly (no re-fetch)
7. Close modal (✕ button, overlay click, or Esc) — no console errors

- [ ] **Step 4: Test error recovery**

To simulate a partial load:
1. Open DevTools Network tab, set throttling to "Offline" mid-way through the 12-month fetch
2. Expected: warning banner at top of table reading "Could not load all 12 months — showing N months retrieved."
3. The months that did load should still render correctly

- [ ] **Step 5: Commit**

```bash
git add src/enhancements/previous-timecard.js
git commit -m "feat: render 12-month table with sticky columns and totals row"
```
