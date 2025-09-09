export class AidAccordion extends HTMLElement {
  constructor() {
    super();
    this._open = true;
    this._onScroll = this._onScroll.bind(this);
  }
  connectedCallback() {
    const title = this.getAttribute('title') ?? 'Section';
    const maxBody = Number(this.getAttribute('max-body-height') ?? 480);

    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { display:block; border:1px solid var(--vscode-widget-border); border-radius: var(--radius, 8px); background: var(--vscode-editor-background); }
        .head {
          position: sticky; top: 0; z-index: 1;
          display:flex; align-items:center; justify-content:space-between;
          padding: 12px 16px; background: var(--vscode-editor-background);
          border-bottom: 1px solid var(--vscode-widget-border);
        }
        .title { display:flex; align-items:center; gap:8px; }
        .badge { font-size: 11px; padding: 2px 8px; border:1px solid var(--vscode-widget-border); border-radius:999px; color: var(--vscode-descriptionForeground); }
        .actions { display:flex; gap:8px; align-items:center; }
        .body {
          position: relative; max-height: ${maxBody}px; overflow:auto;
          padding: 8px 16px 16px 16px;
        }
        .body.collapsed { display:none; }
        .float-up {
          position: sticky; top: 8px; margin-left:auto; display:none; z-index:2;
        }
        .float-up.visible { display:inline-flex; }
        .btn {
          border:1px solid var(--vscode-widget-border); background: var(--vscode-button-background); color: var(--vscode-button-foreground);
          border-radius: var(--radius,8px); padding:4px 8px; font-size:12px; cursor:pointer;
        }
        .btn.ghost { background: transparent; color: var(--vscode-foreground); }
        .btn:hover { background: var(--vscode-button-hoverBackground); }
        ::slotted([slot="item"]) { display:block; }
      </style>
      <div class="head" part="header">
        <div class="title">
          <strong>${title}</strong>
          <span class="badge" id="count">0</span>
        </div>
        <div class="actions">
          <slot name="actions"></slot>
          <button class="btn ghost" id="toggle" type="button" title="Collapse/expand">▾</button>
        </div>
      </div>
      <div class="body" id="body" part="body">
        <button class="btn ghost float-up" id="floatUp" type="button" title="Back to top">↑ Top</button>
        <slot name="item" id="slotItems"></slot>
      </div>
    `;

    this.$body = root.getElementById('body');
    this.$count = root.getElementById('count');
    this.$toggle = root.getElementById('toggle');
    this.$float = root.getElementById('floatUp');
    this.$slot = root.getElementById('slotItems');

    const actionsSlot = root.querySelector('slot[name="actions"]');
    for (const evt of ['pointerdown', 'click', 'keydown']) {
      actionsSlot.addEventListener(evt, e => e.stopPropagation(), { capture: true });
    }

    const updateCount = () => this.$count.textContent = String(this.$slot.assignedElements().length);
    this.$slot.addEventListener('slotchange', updateCount);
    updateCount();

    this.$toggle.addEventListener('click', () => this.toggle());
    root.querySelector('.head').addEventListener('click', (e) => {
      if (!(e.composedPath().some(el => el === this.$toggle))) {
        const path = e.composedPath();
        const fromToggle = path.includes(this.$toggle);
        const fromActions = path.includes(actionsSlot) ||
          path.some(el => el?.getAttribute?.('slot') === 'actions');
        if (fromToggle || fromActions) { return; }
        this.toggle();
      }
    });

    this.$body.addEventListener('scroll', this._onScroll);
    this.$float.addEventListener('click', () => this.$body.scrollTo({ top: 0, behavior: 'smooth' }));
  }
  disconnectedCallback() {
    if (this.$body) {
      this.$body.removeEventListener('scroll', this._onScroll);
    }
  }
  _onScroll() {
    this.$float.classList.toggle('visible', this.$body.scrollTop > 400);
  }
  toggle() {
    this._open = !this._open;
    this.$body.classList.toggle('collapsed', !this._open);
    this.$toggle.textContent = this._open ? '▾' : '▸';
  }
}
customElements.define('aid-accordion', AidAccordion);
