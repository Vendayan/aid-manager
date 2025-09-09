export class AidPlotItem extends HTMLElement {
  connectedCallback() {
    const type = this.getAttribute('type') ?? 'Component';
    const text = (this.textContent || '').trim();
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display:block; }
        .card { border-top: 1px solid var(--vscode-widget-border); padding: 16px 0; }
        .row { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom: 8px; }
        .chip { display:inline-flex; align-items:center; gap:6px; padding:2px 8px; border:1px solid var(--vscode-widget-border); border-radius:999px; color: var(--vscode-descriptionForeground); font-size: 12px; }
        .textarea {
          width:100%; min-height:120px; white-space: pre-wrap;
          color: var(--vscode-input-foreground); background: var(--vscode-input-background);
          border:1px solid var(--vscode-widget-border); border-radius:8px; padding:8px 10px;
        }
      </style>
      <div class="card">
        <div class="row">
          <span class="chip">${type}</span>
          <button class="btn ghost" type="button" title="Remove">Remove</button>
        </div>
        <div class="textarea" contenteditable="true">${text}</div>
      </div>
    `;
  }
}
customElements.define('aid-plot-item', AidPlotItem);
