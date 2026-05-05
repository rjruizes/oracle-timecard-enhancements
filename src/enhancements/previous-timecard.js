/**
 * Previous Timecard Enhancement
 * Displays the prior pay period's timecard alongside the current period in a
 * three-column modal (Previous | Current | Combined).
 * Data is fetched by popup.js via chrome.scripting (MAIN world) so that
 * Oracle's own auth middleware adds the Bearer token automatically.
 */
class PreviousTimecardEnhancement extends Enhancement {
  constructor() {
    super(
      'previous-timecard',
      'Show totals from the previous pay period in a modal',
      false
    );
    this.modal = null;
  }

  async onInit() {}
  async onUpdate() {}
  async onCleanup() { this.closeModal(); }

  getFieldIds(data) {
    const fields = data?.items?.[0]?.timeCardLayouts?.items?.[0]?.timeCardFields?.items || [];
    const ids = {};
    for (const f of fields) {
      if (f.Label) ids[f.Label] = f.TimeCardFieldId;
    }
    return ids;
  }

  // Returns a Map of "project\0task" -> total hours for a given API response
  parseTotalsMap(data) {
    const fieldIds = this.getFieldIds(data);
    const projectId = fieldIds['Project'];
    const taskId = fieldIds['Task'];
    const entries = data?.items?.[0]?.timeCards?.items?.[0]?.timeEntries?.items || [];
    const map = new Map();
    for (const entry of entries) {
      const vals = {};
      for (const f of entry.timeCardFieldValues.items) {
        vals[f.TimeCardFieldId] = f.DisplayValue;
      }
      const project = vals[projectId] || 'Unknown';
      const task = vals[taskId] || 'Unknown';
      const key = `${project}\0${task}`;
      map.set(key, (map.get(key) || 0) + parseFloat(entry.Measure || 0));
    }
    return map;
  }

  buildRows(prevData, currentData) {
    const prevMap = this.parseTotalsMap(prevData);
    const curMap = currentData ? this.parseTotalsMap(currentData) : new Map();
    const keys = new Set([...prevMap.keys(), ...curMap.keys()]);
    return Array.from(keys)
      .map(key => {
        const [project, task] = key.split('\0');
        return { project, task, previous: prevMap.get(key) || 0, current: curMap.get(key) || 0 };
      })
      .sort((a, b) => a.project.localeCompare(b.project) || a.task.localeCompare(b.task));
  }

  fmt(n) {
    return (n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
  }

  fmtMonthLabel(key) {
    const [year, month] = key.split('-');
    const d = new Date(parseInt(year), parseInt(month) - 1, 1);
    return d.toLocaleString('en-US', { month: 'short' }) + " '" + year.slice(2);
  }

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
        const monthHours = sortedKeys.map(mk => monthMap.get(mk).get(key) || 0);
        return { project, task, monthHours };
      })
      .sort((a, b) => a.project.localeCompare(b.project) || a.task.localeCompare(b.task));

    return {
      monthKeys: sortedKeys,
      monthLabels: sortedKeys.map(k => this.fmtMonthLabel(k)),
      rows
    };
  }

  showModal(prevData, currentData) {
    this.closeModal();

    const prevItem = prevData?.items?.[0];
    if (!prevItem) {
      this.showError('No timecard found for the previous period.');
      return;
    }

    const prevStart = prevItem.StartDate?.slice(0, 10) || '';
    const prevStop  = prevItem.StopDate?.slice(0, 10)  || '';
    const prevRange = prevStart && prevStop ? `${prevStart} – ${prevStop}` : '';

    const curItem   = currentData?.items?.[0];
    const curStart  = curItem?.StartDate?.slice(0, 10) || '';
    const curStop   = curItem?.StopDate?.slice(0, 10)  || '';
    const curRange  = curStart && curStop ? `${curStart} – ${curStop}` : 'Current period';

    this._12mPersonId     = curItem?.PersonId  || null;
    this._12mStartDate    = curItem?.StartDate?.slice(0, 10) || null;
    this._12mLoaded       = false;
    this._12mMsgHandler   = null;
    this._12mSessionToken = null;

    const rows = this.buildRows(prevData, currentData);
    const prevTotal = rows.reduce((s, r) => s + r.previous, 0);
    const curTotal  = rows.reduce((s, r) => s + r.current,  0);
    const combTotal = prevTotal + curTotal;

    const rowsHtml = rows.length
      ? rows.map((r, i) => `
          <tr class="${i % 2 === 1 ? 'ote-alt' : ''}">
            <td class="ote-text-col">${r.project}</td>
            <td class="ote-text-col">${r.task}</td>
            <td class="ote-num-col">${this.fmt(r.previous)}</td>
            <td class="ote-num-col ote-cur-col">${this.fmt(r.current)}</td>
            <td class="ote-num-col ote-combined">${this.fmt(r.previous + r.current)}</td>
          </tr>`).join('')
      : '<tr><td colspan="5" class="ote-empty">No entries found</td></tr>';

    const modal = document.createElement('div');
    modal.id = 'ote-prev-modal-root';
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

    const style = document.createElement('style');
    style.id = 'ote-prev-styles';
    style.textContent = `
      #ote-prev-overlay {
        position: fixed; inset: 0;
        background: rgba(15,23,42,0.45);
        z-index: 99998;
      }
      #ote-prev-dialog {
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        background: #fff;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(15,23,42,0.10), 0 1px 2px rgba(15,23,42,0.06);
        border: 1px solid #eef0f3;
        z-index: 99999;
        min-width: 600px;
        max-width: 1000px;
        width: 90vw;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        font-size: 14px;
        color: #1f2328;
        overflow: hidden;
      }
      #ote-prev-dialog.ote-dialog-wide {
        max-width: min(95vw, 1600px);
        width: 95vw;
      }
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
      .ote-12m-table thead th {
        position: sticky;
        top: 0;
        z-index: 2;
        background: #f5f6f8;
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
      #ote-prev-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 18px 22px 14px;
      }
      #ote-prev-header h2 {
        margin: 0 0 2px;
        font-size: 17px;
        font-weight: 700;
        letter-spacing: -0.005em;
      }
      #ote-prev-period { font-size: 13px; color: #9aa0a6; }
      #ote-prev-close {
        background: none; border: none;
        font-size: 18px; cursor: pointer;
        color: #9aa0a6; padding: 4px; line-height: 1;
        border-radius: 4px;
        margin-left: 16px;
      }
      #ote-prev-close:hover { color: #1f2328; }
      #ote-prev-body {
        border-top: 1px solid #eef0f3;
        max-height: 65vh;
        overflow-y: auto;
      }
      #ote-prev-table {
        width: 100%; border-collapse: collapse;
      }
      .ote-th {
        padding: 10px 18px;
        font-size: 13px; font-weight: 600; color: #4b5563;
        background: #f5f6f8;
        border-bottom: 1px solid #e5e7eb;
        vertical-align: top;
        text-align: right;
      }
      .ote-th-inner {
        display: flex; flex-direction: column; gap: 2px; align-items: flex-end;
      }
      .ote-th-inner.ote-th-left { align-items: flex-start; }
      .ote-th-date {
        font-size: 11px; font-weight: 500; color: #9aa0a6;
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
      }
      .ote-cur-label { color: #4b5563; }
      .ote-text-col { text-align: left; }
      .ote-num-col { text-align: right; }
      #ote-prev-table td {
        padding: 14px 18px;
        font-size: 14px;
        border-bottom: 1px solid #eef0f3;
      }
      #ote-prev-table tbody tr.ote-alt td { background: #fafbfc; }
      #ote-prev-table tbody tr:hover td { background: #f0f6ff; }
      .ote-combined {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-variant-numeric: tabular-nums;
        font-weight: 700;
      }
      #ote-prev-table td:not(.ote-text-col):not(.ote-combined) {
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-variant-numeric: tabular-nums;
      }
      .ote-total-cell {
        border-top: 2px solid #e5e7eb;
        border-bottom: none !important;
        background: #fafbfc !important;
        padding-top: 12px;
      }
      .ote-empty { text-align: center; color: #9aa0a6; }
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
      #ote-panel-last-12 {
        max-height: 65vh;
        overflow-y: auto;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);
    this.modal = modal;

    document.getElementById('ote-prev-close').addEventListener('click', () => this.closeModal());
    document.getElementById('ote-prev-overlay').addEventListener('click', () => this.closeModal());
    const panelPrevCur = document.getElementById('ote-panel-prev-cur');
    const panelLast12  = document.getElementById('ote-panel-last-12');
    const dialog       = document.getElementById('ote-prev-dialog');
    modal.querySelectorAll('.ote-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        modal.querySelectorAll('.ote-tab').forEach(t => t.classList.remove('ote-tab-active'));
        tab.classList.add('ote-tab-active');
        const panel = tab.dataset.tab;
        panelPrevCur.style.display = panel === 'prev-cur' ? '' : 'none';
        panelLast12.style.display  = panel === 'last-12'  ? '' : 'none';
        dialog.classList.toggle('ote-dialog-wide', panel === 'last-12');
        if (panel === 'last-12') this._onLast12TabActivated();
      });
    });
    document.addEventListener('keydown', this._escHandler = (e) => {
      if (e.key === 'Escape') this.closeModal();
    });
  }

  closeModal() {
    if (this.modal) { this.modal.remove(); this.modal = null; }
    document.getElementById('ote-prev-styles')?.remove();
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    if (this._12mMsgHandler) {
      window.removeEventListener('message', this._12mMsgHandler);
      this._12mMsgHandler = null;
    }
  }

  _onLast12TabActivated() {
    if (this._12mLoaded) return; // already fetched this session
    if (!this._12mPersonId || !this._12mStartDate) {
      document.getElementById('ote-panel-last-12').innerHTML =
        '<p style="padding:24px;color:#9aa0a6;text-align:center;">Could not determine person or period — please reload the timecard.</p>';
      return;
    }

    this._12mSessionToken = Math.random().toString(36).slice(2);
    this.showLoadingState();

    this._12mMsgHandler = (event) => {
      if (event.source !== window) return;
      if (event.data?.token !== this._12mSessionToken) return;
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
    window.postMessage({ type: 'ote-fetch-12m', personId: this._12mPersonId, startDate: this._12mStartDate, token: this._12mSessionToken }, window.location.origin);
  }

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

  updateProgress(done, total) {
    const doneEl  = document.getElementById('ote-12m-done');
    const barEl   = document.getElementById('ote-12m-bar');
    const totalEl = document.getElementById('ote-12m-total');
    if (!doneEl) return;
    doneEl.textContent  = done;
    totalEl.textContent = total;
    barEl.style.width   = Math.round((done / total) * 100) + '%';
  }

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

  showError(msg) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    Object.assign(toast.style, {
      position: 'fixed', bottom: '24px', left: '50%',
      transform: 'translateX(-50%)',
      background: '#c62828', color: '#fff',
      padding: '12px 20px', borderRadius: '8px',
      zIndex: '999999', fontSize: '14px',
      fontFamily: 'sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }
}
