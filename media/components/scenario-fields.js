export class ScenarioFields extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._data = { description: '', prompt: '', authorsNote: '' };
  }
  setData(d) {
    this._data = d || { description: '', prompt: '', authorsNote: '' };
    this.render();
  }
  connectedCallback() { this.render(); }
  render() {
    const d = this._data;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        .fields {
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        @media (max-width: 860px) { .fields { grid-template-columns: 1fr; } }
        .field { display:grid; gap:6px; }
        .label { font-weight:600; color: var(--vscode-descriptionForeground); }
        textarea {
          width:100%; min-height:120px; resize:none;
          border:1px solid var(--vscode-input-border);
          background: var(--vscode-input-background); color: var(--vscode-input-foreground);
          padding:8px 10px; border-radius:6px; line-height:1.4;
        }
      </style>
      <section class="fields">
        <div class="field">
          <div class="label">Description</div>
          <textarea readonly>${this.escape(d.description)}</textarea>
        </div>
        <div class="field">
          <div class="label">Prompt</div>
          <textarea readonly>${this.escape(d.prompt)}</textarea>
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <div class="label">Author's Note</div>
          <textarea readonly>${this.escape(d.authorsNote)}</textarea>
        </div>
      </section>
    `;
  }
  escape(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
}
customElements.define('scenario-fields', ScenarioFields);
