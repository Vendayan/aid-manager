export class StorycardList extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._cards = [];
    this._filteredIdxs = [];
    this._rendered = 0;
    this._initial = 50;
    this._page = 100;
  }
  setData(cards) {
    this._cards = Array.isArray(cards) ? cards : [];
    this._filteredIdxs = this._cards.map((_, i) => i);
    this._rendered = Math.min(this._initial, this._filteredIdxs.length);
    this.render();
  }
  connectedCallback() { this.render(); }
  render() {
    const css = `
      :host { display:block; }
      .toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:6px; }
      .toolbar input[type="text"] {
        width:320px; max-width:100%; padding:6px 8px; border-radius:4px;
        border:1px solid var(--vscode-input-border);
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      }
      .btn {
        padding:6px 10px; border-radius:4px;
        border:1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-foreground);
        cursor:pointer;
      }
      .list .sc {
        padding:8px; border:1px solid var(--vscode-editorHoverWidget-border);
        border-radius:6px; margin-bottom:8px; background: var(--vscode-editorWidget-background);
      }
      .sc-header { display:flex; justify-content:space-between; gap:8px; font-weight:600; }
      .sc-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:70%; }
      .sc-meta { color: var(--vscode-descriptionForeground); white-space:nowrap; }
      .sc-value { white-space:pre-wrap; margin:6px 0 0 0; }
      .chip { display:inline-block; border:1px solid var(--vscode-editorHoverWidget-border);
        border-radius:999px; padding:2px 8px; font-size:11px; color:var(--vscode-descriptionForeground);
        background:var(--vscode-editorWidget-background); }
    `;
    this.shadowRoot.innerHTML = `
      <style>${css}</style>
      <div class="toolbar">
        <input id="filter" type="text" placeholder="Filter by title / type / keys…" />
        <span id="shown" class="chip">0 shown</span>
        <button id="more" class="btn" style="display:none;">Load more</button>
        <button id="reset" class="btn">Reset</button>
      </div>
      <div class="list" id="list"></div>
    `;
    this.bind();
    this.renderInitial();
  }
  $(q) { return this.shadowRoot.querySelector(q); }
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  mkCard(sc, idx) {
    return (
      '<div class="sc" data-idx="' + idx + '">' +
        '<div class="sc-header">' +
          '<div class="sc-title">#' + (idx + 1) + ' — ' + this.esc(sc.title ?? '(untitled)') + '</div>' +
          '<div class="sc-meta">' + this.esc(sc.type ?? '') + ' • keys: ' + this.esc(sc.keys ?? '') + '</div>' +
        '</div>' +
        '<pre class="sc-value">' + this.esc(sc.value ?? '') + '</pre>' +
      '</div>'
    );
  }
  bind() {
    const filter = this.$('#filter');
    const reset = this.$('#reset');
    const more = this.$('#more');
    if (filter) {
      let t;
      filter.addEventListener('input', () => {
        const v = filter.value;
        if (t) { clearTimeout(t); }
        t = setTimeout(() => { this.applyFilter(v); }, 120);
      });
    }
    if (reset) {
      reset.addEventListener('click', () => {
        if (filter) { filter.value = ''; }
        this.applyFilter('');
      });
    }
    if (more) {
      more.addEventListener('click', () => { this.loadMore(); });
    }
  }
  renderInitial() {
    const list = this.$('#list');
    const shown = this.$('#shown');
    if (!list) { return; }
    list.innerHTML = this._filteredIdxs.slice(0, this._rendered).map(i => this.mkCard(this._cards[i], i)).join('');
    if (shown) { shown.textContent = Math.min(this._rendered, this._filteredIdxs.length) + ' shown'; }
    this.updateMore();
  }
  updateMore() {
    const more = this.$('#more');
    const remain = this._filteredIdxs.length - this._rendered;
    if (!more) { return; }
    if (remain > 0) {
      more.style.display = '';
      more.textContent = 'Load more (' + Math.min(remain, this._page) + ' of ' + remain + ')';
    } else {
      more.style.display = 'none';
    }
  }
  applyFilter(q) {
    const query = (q || '').toLowerCase().trim();
    if (query.length === 0) {
      this._filteredIdxs = this._cards.map((_, i) => i);
    } else {
      const idxs = [];
      for (let i = 0; i < this._cards.length; i++) {
        const sc = this._cards[i];
        const hay = [(sc.title||''),(sc.type||''),(sc.keys||'')].join(' ').toLowerCase();
        if (hay.includes(query)) { idxs.push(i); }
      }
      this._filteredIdxs = idxs;
    }
    this._rendered = Math.min(this._initial, this._filteredIdxs.length);
    this.renderInitial();
  }
  loadMore() {
    const remain = this._filteredIdxs.length - this._rendered;
    if (remain <= 0) { return; }
    const add = Math.min(remain, this._page);
    const slice = this._filteredIdxs.slice(this._rendered, this._rendered + add);
    const list = this.$('#list');
    const frag = document.createDocumentFragment();
    for (let j = 0; j < slice.length; j++) {
      const i = slice[j];
      const wrap = document.createElement('div');
      wrap.innerHTML = this.mkCard(this._cards[i], i);
      frag.appendChild(wrap.firstElementChild);
    }
    if (list) { list.appendChild(frag); }
    this._rendered += add;
    const shown = this.$('#shown');
    if (shown) { shown.textContent = Math.min(this._rendered, this._filteredIdxs.length) + ' shown'; }
    this.updateMore();
  }
}
customElements.define('storycard-list', StorycardList);
