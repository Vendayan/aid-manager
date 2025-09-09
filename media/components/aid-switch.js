export class AidSwitch extends HTMLElement {
  static get observedAttributes() { return ['checked']; }

  constructor() {
    super();
    this._checked = false;
  }

  get checked() { return this._checked; }
  set checked(v) {
    const next = !!v;
    if (this._checked === next) {
      return;
    }
    this._checked = next;
    if (this._input) {
      this._input.checked = next;
    }
    this._reflect();
  }

  connectedCallback() {
    const label = this.getAttribute('label') ?? 'Switch';
    const id = `sw_${Math.random().toString(36).slice(2)}`;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { display:inline-flex; align-items:center; }
        .wrap { display:inline-flex; align-items:center; gap:8px; cursor:pointer; }
        .label { font-size:12px; color: var(--vscode-foreground); }
        input { position:absolute; opacity:0; width:0; height:0; }
        .switch { position: relative; width: 40px; height: 22px; background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border); border-radius: 999px; transition: background .15s ease; }
        .knob { position:absolute; top:1px; left:1px; width:18px; height:18px; border-radius:50%; background: var(--vscode-foreground); opacity:.75; transition: transform .15s ease, background .15s ease, opacity .15s ease; }
        input:focus + .switch { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
        input:checked + .switch { background: var(--vscode-button-background); }
        input:checked + .switch .knob { transform: translateX(18px); opacity:1; background: var(--vscode-button-foreground); }
      </style>
      <label class="wrap" for="${id}">
        <input id="${id}" type="checkbox" role="switch" />
        <span class="switch" aria-hidden="true"><span class="knob"></span></span>
        <span class="label">${label}</span>
      </label>
    `;
    this._input = root.getElementById(id);
    this._input.checked = this._checked || this.hasAttribute('checked');
    this._checked = this._input.checked;

    this._input.addEventListener('change', () => {
      this._checked = this._input.checked;
      this._reflect();
      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    });
  }

  attributeChangedCallback(name, _old, val) {
    if (name === 'checked') {
      this.checked = val !== null;
    }
  }

  _reflect() {
    if (this._checked) {
      this.setAttribute('checked', '');
    }
    else {
      this.removeAttribute('checked');
    }
  }
}
customElements.define('aid-switch', AidSwitch);
