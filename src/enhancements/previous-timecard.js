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
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);
    this.modal = modal;

    document.getElementById('ote-prev-close').addEventListener('click', () => this.closeModal());
    document.getElementById('ote-prev-overlay').addEventListener('click', () => this.closeModal());
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
