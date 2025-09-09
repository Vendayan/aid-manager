export class ScenarioView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._model = null;
  }
  setData(model) {
    this._model = model;
    this.render();
  }
  connectedCallback() { this.render(); }
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  render() {
    const m = this._model || {};
    const imgStyle = m.image ? `style="background:url('${this.esc(m.image)}') center/cover no-repeat"` : '';
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
        .hero { min-height:160px; border-bottom:1px solid var(--vscode-editorHoverWidget-border); position:relative; }
        .hero-inner { position:relative; padding:18px 12px; display:grid; gap:8px; }
        .title input {
          width:100%; padding:6px 10px; border-radius:6px;
          border:1px solid var(--vscode-input-border);
          background: var(--vscode-input-background); color: var(--vscode-input-foreground);
          font-size:1.2rem; font-weight:600;
        }
        .ids { display:flex; flex-wrap:wrap; gap:6px; }
        .chip { display:inline-block; border:1px solid var(--vscode-editorHoverWidget-border);
          border-radius:999px; padding:2px 8px; font-size:11px; color:var(--vscode-descriptionForeground);
          background:var(--vscode-editorWidget-background); }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Courier New", monospace; }
      </style>
      <header class="hero" ${imgStyle}>
        <div class="hero-inner">
          <div class="title"><input id="title" type="text" value="${this.esc(m.title || '')}" /></div>
          <div class="ids">
            ${m.id ? `<span class="chip mono">id: ${this.esc(m.id)}</span>` : ''}
            ${m.shortId ? `<span class="chip mono">shortId: ${this.esc(m.shortId)}</span>` : ''}
            ${m.publicId ? `<span class="chip mono">publicId: ${this.esc(m.publicId)}</span>` : ''}
            ${m.parentScenario ? `<span class="chip">parent: ${this.esc(m.parentScenario.title)} (${this.esc(m.parentScenario.shortId)})</span>` : ''}
          </div>
          <slot></slot>
        </div>
      </header>
    `;
  }
}
customElements.define('scenario-view', ScenarioView);
