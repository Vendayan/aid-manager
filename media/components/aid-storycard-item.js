// Emits custom events:
// - 'storycard:focus' (on click of the item header)
// - 'storycard:change' with { detail: { patch } } (debounced in parent)
// - 'storycard:delete' (on delete button)

export class AidStoryCardItem extends HTMLElement {
  static get observedAttributes() { return ['editable', 'title', 'type', 'keys']; }

  connectedCallback() {
    const num = this.getAttribute('number') ?? '—';
    const title = this.getAttribute('title') ?? 'Untitled';
    const type = this.getAttribute('type') ?? 'card';
    const keys = this.getAttribute('keys') ?? '';
    const body = (this.textContent || '').trim();

    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display:block; }
        .wrap { border-top: 1px solid var(--vscode-widget-border); padding: 16px 0; }
        .row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .title { font-weight:600; cursor:pointer; }
        .meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
        .body { margin-top: 8px; white-space: pre-wrap; }

        .edit { margin-top: 12px; display:none; gap: 12px; }
        .edit .col { flex:1; display:flex; flex-direction:column; gap:8px; }
        .input, .select, .textarea {
          width:100%; color: var(--input-fg); background: var(--input-bg);
          border:1px solid var(--vscode-widget-border); border-radius:8px; padding:8px 10px; outline:none;
        }
        .textarea { min-height: 120px; }
        .btn { border:1px solid var(--vscode-widget-border); background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius:8px; padding:4px 8px; font-size:12px; cursor:pointer; }
        .btn.ghost { background:transparent; color: var(--vscode-foreground); }
        .btn:hover { background: var(--vscode-button-hoverBackground); }
      </style>
      <div class="wrap">
        <div class="row">
          <div>
            <div class="title" id="head">#${num} — <span id="t">${this._esc(title)}</span></div>
            <div class="meta" id="m">${this._esc(type)}${keys ? ' • ' + this._esc(keys) : ''}</div>
          </div>
          <div>
            <button class="btn ghost" id="del" type="button" title="Delete">Delete</button>
          </div>
        </div>
        <div class="body" id="body">${this._esc(body)}</div>

        <div class="edit" id="edit">
          <div class="col">
            <input id="eTitle" class="input" type="text" placeholder="Title" />
            <input id="eKeys" class="input" type="text" placeholder="Keys (comma-separated)" />
            <select id="eType" class="select">
              <option value="character">character</option>
              <option value="location">location</option>
              <option value="item">item</option>
              <option value="event">event</option>
              <option value="card">card</option>
            </select>
          </div>
          <div class="col">
            <textarea id="eBody" class="textarea" placeholder="Body"></textarea>
          </div>
        </div>
      </div>
    `;

    this.$ = (s) => this.shadowRoot.querySelector(s);
    this.$head = this.$('#head');
    this.$title = this.$('#t');
    this.$meta = this.$('#m');
    this.$body = this.$('#body');
    this.$edit = this.$('#edit');

    this.$e = {
      title: this.$('#eTitle'),
      keys: this.$('#eKeys'),
      type: this.$('#eType'),
      body: this.$('#eBody'),
    };

    // Init values
    this.$e.title.value = title;
    this.$e.keys.value = keys;
    this.$e.type.value = type;
    this.$e.body.value = body;

    // Focus/edit toggle
    this.$head.addEventListener('click', () => this._emitFocus());
    // Delete
    this.$('#del').addEventListener('click', () => this.dispatchEvent(new CustomEvent('storycard:delete', { bubbles: true, composed: true })));

    // Change emitters
    const emit = () => {
      const patch = {
        title: this.$e.title.value,
        keys: this.$e.keys.value,
        type: this.$e.type.value,
        body: this.$e.body.value,
      };
      this.$title.textContent = patch.title || 'Untitled';
      this.$meta.textContent = `${patch.type}${patch.keys ? ' • ' + patch.keys : ''}`;
      this.$body.textContent = patch.body || '';
      this.dispatchEvent(new CustomEvent('storycard:change', { detail: { patch }, bubbles: true, composed: true }));
    };
    ['input', 'change'].forEach(ev => {
      this.$e.title.addEventListener(ev, emit);
      this.$e.keys.addEventListener(ev, emit);
      this.$e.type.addEventListener(ev, emit);
      this.$e.body.addEventListener(ev, emit);
    });

    // Apply editable state if attribute present
    if (this.hasAttribute('editable')) { this._applyEditable(true); }
  }

  attributeChangedCallback(name, _o, n) {
    if (!this.isConnected) { return; }
    if (name === 'editable') {
      this._applyEditable(n !== null);
    }
    if (name === 'title') { this.$('#t').textContent = n || 'Untitled'; }
    if (name === 'type' || name === 'keys') {
      const type = (name === 'type' ? n : this.getAttribute('type')) || 'card';
      const keys = (name === 'keys' ? n : this.getAttribute('keys')) || '';
      this.$('#m').textContent = `${type}${keys ? ' • ' + keys : ''}`;
    }
  }

  _applyEditable(on) {
    this.$('#edit').style.display = on ? 'flex' : 'none';
  }

  _emitFocus() {
    this.dispatchEvent(new CustomEvent('storycard:focus', { bubbles: true, composed: true }));
  }

  _esc(s) {
    return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
}
customElements.define('aid-storycard-item', AidStoryCardItem);
