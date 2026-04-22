/**
 * Previous Timecard Enhancement
 * Displays the prior pay period's timecard in a modal overlay.
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

  // Detect Project and Task field IDs from the layout definition
  getFieldIds(data) {
    const fields = data?.items?.[0]?.timeCardLayouts?.items?.[0]?.timeCardFields?.items || [];
    const ids = {};
    for (const f of fields) {
      if (f.Label) ids[f.Label] = f.TimeCardFieldId;
    }
    return ids;
  }

  parseTotals(data) {
    const fieldIds = this.getFieldIds(data);
    const projectId = fieldIds['Project'];
    const taskId = fieldIds['Task'];

    const entries = data?.items?.[0]?.timeCards?.items?.[0]?.timeEntries?.items || [];
    const totals = new Map();

    for (const entry of entries) {
      const vals = {};
      for (const f of entry.timeCardFieldValues.items) {
        vals[f.TimeCardFieldId] = f.DisplayValue;
      }
      const project = vals[projectId] || 'Unknown';
      const task = vals[taskId] || 'Unknown';
      const key = `${project}\0${task}`;
      totals.set(key, (totals.get(key) || 0) + parseFloat(entry.Measure || 0));
    }

    return Array.from(totals.entries())
      .map(([key, hours]) => {
        const [project, task] = key.split('\0');
        return { project, task, hours };
      })
      .sort((a, b) => a.project.localeCompare(b.project) || a.task.localeCompare(b.task));
  }

  showModal(data) {
    this.closeModal();

    const item = data?.items?.[0];
    if (!item) {
      this.showError('No timecard found for the previous period.');
      return;
    }

    const startDate = item.StartDate?.slice(0, 10) || '';
    const stopDate = item.StopDate?.slice(0, 10) || '';
    const rows = this.parseTotals(data);
    const totalHours = rows.reduce((s, r) => s + r.hours, 0);

    const rowsHtml = rows.length
      ? rows.map(r => `
          <tr>
            <td>${r.project}</td>
            <td>${r.task}</td>
            <td class="ote-hours">${r.hours.toFixed(2)}</td>
          </tr>`).join('')
      : '<tr><td colspan="3" style="text-align:center;color:#999">No entries found</td></tr>';

    const modal = document.createElement('div');
    modal.id = 'ote-prev-modal-root';
    modal.innerHTML = `
      <div id="ote-prev-overlay"></div>
      <div id="ote-prev-dialog" role="dialog" aria-modal="true">
        <div id="ote-prev-header">
          <div>
            <h2>Previous Timecard</h2>
            <span id="ote-prev-period">${startDate} – ${stopDate}</span>
          </div>
          <button id="ote-prev-close" title="Close">&#x2715;</button>
        </div>
        <div id="ote-prev-body">
          <table id="ote-prev-table">
            <thead>
              <tr><th>Project</th><th>Task</th><th class="ote-hours">Hours</th></tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot>
              <tr>
                <td colspan="2"><strong>Total</strong></td>
                <td class="ote-hours"><strong>${totalHours.toFixed(2)}</strong></td>
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
        background: rgba(0,0,0,0.45);
        z-index: 99998;
      }
      #ote-prev-dialog {
        position: fixed;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        background: #fff;
        border-radius: 10px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.2);
        z-index: 99999;
        min-width: 500px;
        max-width: 720px;
        width: 90vw;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
      }
      #ote-prev-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 18px 20px 14px;
        border-bottom: 1px solid #e0e0e0;
      }
      #ote-prev-header h2 {
        margin: 0 0 4px;
        font-size: 16px;
        color: #1a73e8;
      }
      #ote-prev-period { font-size: 12px; color: #888; }
      #ote-prev-close {
        background: none; border: none;
        font-size: 18px; cursor: pointer;
        color: #999; padding: 0; line-height: 1;
        margin-left: 16px;
      }
      #ote-prev-close:hover { color: #333; }
      #ote-prev-body { padding: 16px 20px; max-height: 60vh; overflow-y: auto; }
      #ote-prev-table { width: 100%; border-collapse: collapse; }
      #ote-prev-table th, #ote-prev-table td {
        padding: 8px 10px; text-align: left; border-bottom: 1px solid #f0f0f0;
      }
      #ote-prev-table th {
        font-weight: 600; color: #555; background: #f8f9fa; position: sticky; top: 0;
      }
      #ote-prev-table .ote-hours { text-align: right; }
      #ote-prev-table tbody tr:hover { background: #f0f6ff; }
      #ote-prev-table tfoot td { border-top: 2px solid #ddd; border-bottom: none; padding-top: 10px; }
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
