import '../components/aid-switch.js';
import '../components/aid-accordion.js';
import '../components/aid-plot-item.js';
import '../components/aid-storycard-item.js';

const vscode = acquireVsCodeApi?.() ?? { postMessage: () => {} };

class ScenarioEditor extends HTMLElement {
  constructor() {
    super();
    this.state = {
      model: null,
      plotComponents: {},
      storyCards: [],
      selectedCardId: null,
    };
    this.debouncers = new Map(); // id -> timeout
  }

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  connectedCallback() {
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        .app { display:block; color: var(--vscode-foreground); background: var(--vscode-editor-background); min-height: 100vh; }
        .app-header { position: sticky; top: 0; z-index: 10; display:flex; align-items:center; justify-content:space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--vscode-editor-background); box-shadow: var(--shadow); border-bottom: 1px solid var(--vscode-widget-border); }
        .eyebrow { font-weight:600; letter-spacing:.04em; text-transform:uppercase; color: var(--vscode-descriptionForeground); font-size:12px; }
        .chips { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .chip { display:inline-flex; align-items:center; gap:6px; padding:2px 8px; border:1px solid var(--vscode-widget-border); border-radius:999px; color:var(--vscode-descriptionForeground); font-size:12px; }
        .pill { border:1px solid var(--vscode-widget-border); border-radius:999px; padding:4px 10px; font-size:12px; opacity:.8; }
        .container { max-width:1100px; margin:0 auto; padding: var(--space-5) var(--space-4); display:grid; gap: var(--space-5); }
        .card { border:1px solid var(--vscode-widget-border); border-radius: var(--radius,8px); background: var(--vscode-editor-background); padding: var(--space-4); }
        .title { margin:0 0 var(--space-3); font-size:12px; letter-spacing:.05em; text-transform:uppercase; color: var(--vscode-descriptionForeground); }
        .grid { display:grid; grid-template-columns: 1fr; gap: var(--space-4) var(--space-5); }
        .full { grid-column:1; }
        @media (min-width:1100px){ .grid { grid-template-columns:1fr 1fr; } .full { grid-column:1 / -1; } }
        .field { display:flex; flex-direction:column; gap: var(--space-2); }
        .row { display:flex; gap: var(--space-4); align-items:flex-start; }
        .label { font-size:11px; letter-spacing:.05em; text-transform:uppercase; color: var(--vscode-descriptionForeground); }
        .input, .select, .textarea { color: var(--input-fg); background: var(--input-bg); border:1px solid var(--vscode-widget-border); border-radius: var(--radius,8px); padding:8px 10px; outline:none; }
        .input:focus, .select:focus, .textarea:focus { border-color: var(--vscode-focusBorder); }
        .textarea-sm { min-height:120px; }
        .textarea-lg { min-height:180px; }
        .switches { display:flex; flex-wrap:wrap; gap: var(--space-3); align-items:center; }
        .imgwrap { width: 100%; display:flex; justify-content:flex-end; }
        .cover { max-width: 280px; max-height: 180px; object-fit: cover; width:100%; border:1px solid var(--vscode-widget-border); border-radius: var(--radius,8px); background: #0003; display:none; }
        .hidden { display:none !important; }

        /* Accordion header actions */
        .header-actions { display:inline-flex; gap:8px; align-items:center; }
        .btn { border:1px solid var(--vscode-widget-border); background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: var(--radius,8px); padding:6px 10px; cursor:pointer; }
        .btn:hover { background: var(--vscode-button-hoverBackground); }
        .btn.ghost { background: transparent; color: var(--vscode-foreground); }
        .btn-compact { padding:4px 8px; font-size:12px; }
        .input-compact, .select-compact { padding:6px 8px; font-size:12px; }
      </style>

      <div class="app">
        <!-- Header -->
        <header class="app-header">
          <div><span class="eyebrow">Edit Scenario</span></div>
          <div class="chips">
            <span class="chip" title="Scenario ID">id: <strong id="chip-id">—</strong></span>
            <span class="chip" title="Short ID">shortId: <strong id="chip-short">—</strong></span>
            <span class="chip" title="Public ID">publicId: <strong id="chip-public">—</strong></span>
          </div>
        </header>

        <main class="container">
          <!-- DETAILS -->
          <section class="card" id="section-details">
            <h2 class="title">Details</h2>
            <div class="grid">
              <div class="field full">
                <label class="label" for="title">Title</label>
                <input id="title" class="input" type="text" placeholder="Scenario title…" />
              </div>

              <div class="field">
                <label class="label" for="tags">Tags</label>
                <input id="tags" class="input" type="text" placeholder="WIP, term-one, term-two" />
              </div>

              <div class="field">
                <label class="label" for="rating">Content Rating</label>
                <select id="rating" class="select">
                  <option value="Unrated">Unrated</option>
                  <option value="Everyone">Everyone</option>
                  <option value="Teen">Teen</option>
                  <option value="Mature">Mature</option>
                </select>
              </div>

              <div class="field full switches" id="switches">
                <aid-switch id="sw-published" label="Published"></aid-switch>
                <aid-switch id="sw-unlisted" label="Unlisted"></aid-switch>
                <aid-switch id="sw-allow" label="Allow comments"></aid-switch>
                <aid-switch id="sw-show" label="Show comments"></aid-switch>
              </div>

              <div class="field">
                <label class="label" for="description">Description</label>
                <textarea id="description" class="textarea textarea-sm" placeholder="Provide a brief description of what players can expect…"></textarea>
              </div>

              <div class="field">
                <label class="label" for="authorsNote">Author’s Note</label>
                <textarea id="authorsNote" class="textarea textarea-sm" placeholder="Notes for players…"></textarea>
              </div>

              <div class="field full">
                <div class="row">
                  <div class="field" style="flex:1;">
                    <label class="label" for="type">Type</label>
                    <select id="type" class="select">
                      <option value="standard">standard</option>
                      <option value="multipleChoice">multipleChoice</option>
                    </select>
                  </div>
                  <div class="imgwrap" style="flex:1;">
                    <img id="cover" class="cover" alt="Scenario image" />
                  </div>
                </div>
              </div>

            </div>
          </section>

          <!-- PROMPT -->
          <section class="card" id="section-prompt">
            <h2 class="title">Prompt</h2>
            <textarea id="promptText" class="textarea textarea-lg" placeholder="It starts here…"></textarea>
          </section>

          <!-- PLOT COMPONENTS -->
          <section id="section-plot">
            <aid-accordion id="plot-accordion" title="Plot Components" max-body-height="460">
              <div slot="actions" class="header-actions">
                <select id="plot-add" class="select select-compact" title="Add component">
                  <option disabled selected>+ Add component</option>
                </select>
              </div>
              <!-- Items populated dynamically -->
            </aid-accordion>
          </section>

          <!-- STORY CARDS -->
          <section id="section-cards">
            <aid-accordion id="cards-accordion" title="Story Cards" max-body-height="560">
              <div slot="actions" class="header-actions">
                <input id="cards-filter" class="input input-compact" type="text" placeholder="Filter by title / type / keys…" />
                <button id="btn-add-card" class="btn ghost btn-compact" type="button">Add</button>
              </div>
              <!-- Items populated dynamically -->
            </aid-accordion>
          </section>
        </main>
      </div>
    `;

    // Cache refs
    const $ = (sel) => this.shadowRoot.querySelector(sel);
    this.$chips = { id: $('#chip-id'), short: $('#chip-short'), public: $('#chip-public') };
    this.$img = $('#cover');

    this.$fields = {
      title: $('#title'),
      tags: $('#tags'),
      rating: $('#rating'),
      description: $('#description'),
      authorsNote: $('#authorsNote'),
      prompt: $('#promptText'),
      type: $('#type'),
      sw: {
        published: $('#sw-published'),
        unlisted: $('#sw-unlisted'),
        allowComments: $('#sw-allow'),
        showComments: $('#sw-show'),
      }
    };

    this.$sections = {
      details: $('#section-details'),
      prompt: $('#section-prompt'),
      plot: $('#section-plot'),
      cards: $('#section-cards'),
    };

    this.$accordions = {
      plot: this.shadowRoot.getElementById('plot-accordion'),
      cards: this.shadowRoot.getElementById('cards-accordion'),
    };

    this.$plotAdd = this.shadowRoot.getElementById('plot-add');
    this.$cardsFilter = this.shadowRoot.getElementById('cards-filter');
    this.$btnAddCard = this.shadowRoot.getElementById('btn-add-card');

    // Wire field changes → scenario:dirty
    this._wireField('title');
    this._wireField('tags');
    this._wireField('rating');
    this._wireField('description', true);
    this._wireField('authorsNote', true);
    this._wireField('prompt', true);
    this._wireField('type');

    this._wireSwitch('published');
    this._wireSwitch('unlisted');
    this._wireSwitch('allowComments', 'allow');
    this._wireSwitch('showComments', 'show');

    // Cards toolbar
    this.$btnAddCard.addEventListener('click', () => vscode.postMessage({ type: 'storycard:create' }));
    this.$cardsFilter.addEventListener('input', () => this._renderStoryCards());

    // Listen for init/update from host
    window.addEventListener('message', (e) => this._onMessage(e.data));
  }

  /* ===== messaging ===== */

  _onMessage(msg) {
    switch (msg.type) {
      case 'scenario:init': {
        const { model, plotComponents, storyCards } = msg;
        this.state.model = model ?? {};
        this.state.plotComponents = plotComponents ?? {};
        if(Array.isArray(storyCards)) {
          this.state.storyCards = storyCards.slice();
        } else if (Array.isArray(model.storyCards)) {
          this.state.storyCards = model.storyCards.slice();
        } else {
          this.state.storyCards = [];
        }
        this._hydrate();
        break;
      }
      case 'storyCards:set': {
        this.state.storyCards = Array.isArray(msg.storyCards) ? msg.storyCards.slice() : [];
        this._renderStoryCards();
        break;
      }
      default:
        // no-op
        break;
    }
  }

  /* ===== binding & render ===== */

  _hydrate() {
    const m = this.state.model ?? {};

    // Chips
    this.$chips.id.textContent = m.id ?? '—';
    this.$chips.short.textContent = m.shortId ?? '—';
    this.$chips.public.textContent = m.publicId ?? '—';

    //this.$sections.details.style.background = `url('${this.esc(m.image)}/thumb') center/cover no-repeat`;

    // Image
    if (m.image) {
      this.$img.src = m.image + '/thumb';
      this.$img.style.display = 'block';
    } else {
      this.$img.style.display = 'none';
      this.$img.removeAttribute('src');
    }

    // Details
    this.$fields.title.value = m.title ?? '';
    this.$fields.tags.value = Array.isArray(m.tags) ? m.tags.join(', ') : (m.tags ?? '');
    this.$fields.rating.value = m.rating ?? 'Unrated';
    this.$fields.description.value = m.description ?? '';
    this.$fields.authorsNote.value = m.authorsNote ?? '';
    this.$fields.prompt.value = m.prompt ?? '';
    this.$fields.type.value = m.type ?? 'standard';

    // Switches
    this._setSwitch(this.$fields.sw.published, !!m.published);
    this._setSwitch(this.$fields.sw.unlisted, !!m.unlisted);
    this._setSwitch(this.$fields.sw.allowComments, !!m.allowComments);
    this._setSwitch(this.$fields.sw.showComments, !!m.showComments);

    // Hide/show by type
    this._applyTypeVisibility();

    // Plot components
    this._populatePlotAdd();
    this._renderPlotComponents();

    // Cards
    this._renderStoryCards();
  }

  _applyTypeVisibility() {
    const isMC = (this.state.model?.type === 'multipleChoice') || (this.$fields.type.value === 'multipleChoice');
    this.$sections.prompt.classList.toggle('hidden', isMC);
    this.$sections.plot.classList.toggle('hidden', isMC);
    this.$sections.cards.classList.toggle('hidden', isMC);
  }

  _populatePlotAdd() {
    const $sel = this.$plotAdd;
    // Allowed types: adapt to your real list; using a small sample.
    const allowed = ['Setting','Backstory','Factions','Quest Hook','Theme','Conflict'];
    const existing = new Set(Object.keys(this.state.plotComponents || {}));
    // Rebuild options
    $sel.innerHTML = `<option disabled selected>+ Add component</option>` + allowed
      .map(t => `<option value="${t}" ${existing.has(t) ? 'disabled' : ''}>${t}</option>`)
      .join('');
  }

  _renderPlotComponents() {
    const acc = this.$accordions.plot;
    // Remove existing items
    acc.querySelectorAll('[slot="item"]').forEach(el => el.remove());
    const entries = Object.values(this.state.plotComponents || {});
    for (const pc of entries) {
      const item = document.createElement('aid-plot-item');
      item.setAttribute('slot', 'item');
      item.setAttribute('type', pc.type);
      item.textContent = pc.text ?? '';
      acc.appendChild(item);
    }
  }

  _renderStoryCards() {
    const acc = this.$accordions.cards;
    // Clear items
    acc.querySelectorAll('[slot="item"]').forEach(el => el.remove());

    const q = (this.$cardsFilter?.value || '').toLowerCase().trim();
    const cards = this.state.storyCards.filter(c => {
      if (!q) {
        return true;
      }
      return (c.title?.toLowerCase()?.includes(q) || c.type?.toLowerCase()?.includes(q) || c.keys?.toLowerCase()?.includes(q) || c.body?.toLowerCase()?.includes(q));
    });

    let idx = 0;
    for (const c of cards) {
      idx += 1;
      const row = document.createElement('aid-storycard-item');
      row.setAttribute('slot', 'item');
      row.setAttribute('number', String(idx));
      row.setAttribute('data-id', c.id ?? '');
      row.setAttribute('title', c.title ?? 'Untitled');
      row.setAttribute('type', c.type ?? 'card');
      if (c.keys) {
        row.setAttribute('keys', c.keys);
      }
      row.textContent = c.body ?? '';

      // Enable focus/edit on click
      row.addEventListener('storycard:focus', () => {
        this._focusCard(c.id);
        vscode.postMessage({ type: 'storycard:focus', id: c.id });
      });

      // Propagate edits with debounce
      row.addEventListener('storycard:change', (ev) => {
        const patch = ev.detail?.patch || {};
        this._debouncedUpdateCard(c.id, patch);
      });

      // Delete
      row.addEventListener('storycard:delete', () => {
        vscode.postMessage({ type: 'storycard:delete', id: c.id });
      });

      // Set focused state if matches
      if (c.id && c.id === this.state.selectedCardId) {
        row.setAttribute('editable', '');
      }

      acc.appendChild(row);
    }
  }

  _focusCard(id) {
    this.state.selectedCardId = id;
    // Toggle 'editable' on items based on id
    this.$accordions.cards.querySelectorAll('aid-storycard-item[slot="item"]').forEach(el => {
      const cid = el.getAttribute('data-id');
      if (cid === id) {
        el.setAttribute('editable', '');
      }
      else {
        el.removeAttribute('editable');
      }
    });
  }

  _debouncedUpdateCard(id, patch) {
    const key = String(id || 'new');
    const prev = this.debouncers.get(key);
    if (prev) {
      clearTimeout(prev);
    }
    const t = setTimeout(() => {
      vscode.postMessage({ type: 'storycard:update', id, patch });
    }, 400);
    this.debouncers.set(key, t);
  }

  /* ===== helpers ===== */

  _wireField(name, isTextarea = false) {
    const el = this.$fields[name];
    if (!el) {
      return;
    }
    const evt = isTextarea ? 'input' : 'change';
    el.addEventListener(evt, () => {
      // reflect in local model
      if (!this.state.model) {
        this.state.model = {};
      }
      this.state.model[name] = el.value;
      if (name === 'type') {
        this._applyTypeVisibility();
      }
      vscode.postMessage({ type: 'scenario:dirty', field: name, value: el.value });
    });
  }

  _wireSwitch(key, idKey = null) {
    const el = idKey ? this.$fields.sw[idKey] : this.$fields.sw[key];
    if (!el) {
      return;
    }
    el.addEventListener('change', () => {
      if (!this.state.model) {
        this.state.model = {};
      }
      const val = !!el.checked;
      this.state.model[key] = val;
      vscode.postMessage({ type: 'scenario:dirty', field: key, value: val });
    });
  }

  _setSwitch(el, checked) {
    if (!el) {
      return;
    }
    el.checked = !!checked; // uses property on the custom element (forwarded to internal input)
  }
}

customElements.define('scenario-editor', ScenarioEditor);
