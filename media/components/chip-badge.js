export class ChipBadge extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }
  connectedCallback() {
    const text = this.getAttribute('text') || '';
    const mono = this.hasAttribute('mono');
    this.shadowRoot.innerHTML = `
      <style>
        .chip { display:inline-block; border:1px solid var(--vscode-editorHoverWidget-border);
          border-radius:999px; padding:2px 8px; font-size:11px; color:var(--vscode-descriptionForeground);
          background:var(--vscode-editorWidget-background); }
        .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Courier New", monospace; }
      </style>
      <span class="chip ${mono ? 'mono' : ''}">${this.esc(text)}</span>
    `;
  }
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
}
customElements.define('chip-badge', ChipBadge);
