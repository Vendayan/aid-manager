import * as vscode from "vscode";
import { AIDClient } from "./AIDClient";
import { Scenario, Script, FIELD_BY_EVENT, ScriptEvent } from "./AIDTypes";
import { LocalStore, ScenarioSnapshot } from "./LocalStore";

export class ScenarioTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private _scenarioItems = new Map<string, ScenarioItem>(); // shortId -> item
  private store = new LocalStore();

  // ---- root pagination state ----
  private pageSize = 100;
  private rootItems: Scenario[] = [];
  private pinned: Scenario[] = [];
  private rootOffset = 0;
  private rootEnded = false;
  private rootLoading = false;

  // ---- memo & metadata caches to avoid repoll/loops ----
  private scenarioInfoCache = new Map<string, { isContainer: boolean; children: Scenario[] }>();
  private nodeMetaCache = new Map<string, { kind: "container" | "leaf" | "unknown"; desc?: string }>();

  constructor(private client: AIDClient) {
    this.store.onDidChange((shortId) => {
      if (!shortId) {
        this._onDidChange.fire(undefined);
        return;
      }
      const node = this._scenarioItems.get(shortId);
      this._onDidChange.fire(node);
    });
  }

  // ----- public API -----

  refresh() {
    this._scenarioItems.clear();
    // reset paging
    this.rootItems = [];
    this.rootOffset = 0;
    this.rootEnded = false;
    this.rootLoading = false;
    // clear caches
    this.scenarioInfoCache.clear();
    this.nodeMetaCache.clear();
    this._onDidChange.fire(undefined);
  }

  addPinnedScenario(s: Scenario) {
    const idx = this.pinned.findIndex(p => p.shortId === s.shortId);
    if (idx >= 0) {
      this.pinned[idx] = s;
    } else {
      this.pinned.unshift(s);
    }
    this._onDidChange.fire(undefined);
  }

  removePinned(shortId: string) {
    const idx = this.pinned.findIndex(p => p.shortId === shortId);
    if (idx >= 0) {
      this.pinned.splice(idx, 1);
      this._onDidChange.fire(undefined);
    }
  }

  async loadMoreRoot(): Promise<void> {
    if (this.rootEnded || this.rootLoading) {
      return;
    }
    this.rootLoading = true;
    try {
      const { items, hasMore } = await this.client.listScenariosPage({
        limit: this.pageSize,
        offset: this.rootOffset
      });
      this.rootItems = this.rootItems.concat(items);
      this.rootOffset += items.length;
      this.rootEnded = !hasMore;
      this._onDidChange.fire(undefined);
    } finally {
      this.rootLoading = false;
    }
  }

  setServerCache(shortId: string, snap: ScenarioSnapshot) { this.store.setSnapshot(shortId, snap); }
  requestLocalRefresh(shortId: string) { this.store.requestLocalRefresh(shortId); }

  /**
   * FULL reload of one scenario:
   * - clear LocalStore snapshot
   * - clear LocalStore overrides
   * - clear container/children memo + node meta
   * - set store "force reload" flag
   * - poke the specific node to re-render (next expand refetches)
   */
  requestServerReload(shortId: string) {
    this.store.clearSnapshot(shortId);
    this.store.clearOverrides(shortId);
    this.store.requestServerReload(shortId);

    this.scenarioInfoCache.delete(shortId);
    this.nodeMetaCache.delete(shortId);

    const node = this._scenarioItems.get(shortId);
    if (node) {
      this._onDidChange.fire(node);
    } else {
      this._onDidChange.fire(undefined);
    }
  }

  clearOverridesForScenario(shortId: string) { this.store.clearOverrides(shortId); }
  markScriptExists(shortId: string, event: ScriptEvent) { this.store.setOverride(shortId, event, "exists"); }
  markScriptMissing(shortId: string, event: ScriptEvent) { this.store.setOverride(shortId, event, "missing"); }

  getTreeItem(el: vscode.TreeItem) { return el; }

  async getChildren(el?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    // Don't hit the API if auth isn't valid. This never prompts.
    if (typeof (this.client as any).preflightAuth === "function") {
      const state = await (this.client as any).preflightAuth();
      if (state !== "valid") {
        return [];
      }
    }

    try {
      if (!el) {
        // first page on demand
        if (!this.rootItems.length && !this.rootEnded && !this.rootLoading) {
          await this.loadMoreRoot();
        }
        if (!this.rootItems.length && this.rootEnded) {
          return [new InfoItem("No scenarios found.")];
        }

        // Build ScenarioItem[] for the map from pinned + paged results (dedup by shortId), pinned first.
        const combined: Array<{ data: Scenario; pinned: boolean }> = [];
        const seen = new Set<string>();
        for (const s of this.pinned) {
          if (!seen.has(s.shortId)) {
            combined.push({ data: s, pinned: true });
            seen.add(s.shortId);
          }
        }
        for (const s of this.rootItems) {
          if (!seen.has(s.shortId)) {
            combined.push({ data: s, pinned: false });
            seen.add(s.shortId);
          }
        }
        const scenarioItems: ScenarioItem[] = combined.map(({ data, pinned }) => new ScenarioItem(data, pinned));

        this._scenarioItems.clear();
        for (const it of scenarioItems) {
          this._scenarioItems.set(it.data.shortId, it);
        }

        // then assemble the returned array as TreeItem[] so we can append LoadMoreItem
        const items: vscode.TreeItem[] = [...scenarioItems];
        if (!this.rootEnded) {
          items.push(new LoadMoreItem());
        }
        return items;
      }

      if (el instanceof ScenarioItem) {
        const shortId = el.data.shortId;
        const scenarioName = el.data.title;

        // ---- container vs leaf detection with memo ----
        let info = this.scenarioInfoCache.get(shortId);
        if (!info) {
          info = await this.client.getScenarioInfo(shortId);
          this.scenarioInfoCache.set(shortId, info);
        }

        const kind: "container" | "leaf" = info.isContainer ? "container" : "leaf";
        const desc = info.isContainer ? `${info.children.length} options` : undefined;

        // Only notify UI if metadata actually changed
        const prev = this.nodeMetaCache.get(shortId);
        const changed = !prev || prev.kind !== kind || prev.desc !== desc;
        if (changed) {
          this.nodeMetaCache.set(shortId, { kind, desc });
          el.setKind(kind);
          el.description = desc;
          this._onDidChange.fire(el);
        } else {
          el.setKind(kind);
          el.description = desc;
        }

        if (kind === "container") {
          if (info.children.length === 0) {
            return [new InfoItem("No options under this scenario.")];
          }
          const childItems: ScenarioItem[] = info.children.map(s => new ScenarioItem(s));
          for (const it of childItems) {
            this._scenarioItems.set(it.data.shortId, it);
          }
          return childItems;
        }

        // ---- leaf: show scripts (existing behavior) ----
        let snapshot = this.store.getSnapshot(shortId);

        // Fetch from server only if forced or cache is empty.
        if (this.store.consumeServerReload(shortId) || !snapshot) {
          try {
            const s = await this.client.getScenarioScripting(shortId);
            snapshot = {
              sharedLibrary: s.gameCodeSharedLibrary ?? null,
              onInput: s.gameCodeOnInput ?? null,
              onOutput: s.gameCodeOnOutput ?? null,
              onModelContext: s.gameCodeOnModelContext ?? null
            };
            this.store.setSnapshot(shortId, snapshot);
          } catch (err: any) {
            const msg = String(err?.message || err);
            const friendly = msg.includes("AUTH")
              ? "Authentication required to load scripts."
              : "Scripts unavailable (not owner or access denied).";
            return [new InfoItem(friendly)];
          }
        }

        return this.rowsFrom(shortId, scenarioName, snapshot);
      }

      return [];
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg === "AUTH_MISSING" || msg === "AUTH_EXPIRED") {
        return [];
      }
      return [new InfoItem(`Error: ${msg}`)];
    }
  }

  private rowsFrom(shortId: string, scenarioName: string, s?: ScenarioSnapshot): vscode.TreeItem[] {
    const defs = [
      { event: "sharedLibrary" as const, name: "Shared Library" },
      { event: "onInput" as const, name: "Input" },
      { event: "onOutput" as const, name: "Output" },
      { event: "onModelContext" as const, name: "Context" },
    ];

    return defs.map(d => {
      const exists = this.store.effectiveExists(shortId, d.event);
      const data: Script & { exists: boolean } = {
        scenarioShortId: shortId,
        scenarioName,
        name: d.name,
        event: d.event,
        fieldId: FIELD_BY_EVENT[d.event],
        exists
      };
      return new ScriptRow(data);
    });
  }
}

// ===== Tree items =====
class ScenarioItem extends vscode.TreeItem {
  constructor(public readonly data: Scenario, public readonly pinned: boolean = false) {
    super(data.title, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = this.contextFor("unknown");
    this.tooltip = `Scenario: ${data.title}`;
    this.iconPath = new vscode.ThemeIcon("symbol-structure");
  }

  private contextFor(kind: "container" | "leaf" | "unknown") {
    return this.pinned ? `scenario.pinned.${kind}` : `scenario.${kind}`;
  }

  setKind(kind: "container" | "leaf") {
    this.contextValue = this.contextFor(kind);
  }
}

class ScriptRow extends vscode.TreeItem {
  constructor(public readonly data: Script & { exists: boolean }) {
    super(data.name, vscode.TreeItemCollapsibleState.None);

    this.contextValue = data.exists ? "script" : "script.missing";

    this.tooltip = data.exists
      ? `${data.name} for ${data.scenarioName} [${data.event}]`
      : `${data.name} for ${data.scenarioName} [${data.event}] — click to edit (not yet saved)`;

    this.iconPath = data.exists
      ? new vscode.ThemeIcon("file-code")
      : new vscode.ThemeIcon("file-code", new vscode.ThemeColor("disabledForeground"));

    this.description = data.exists ? undefined : "create";

    this.command = {
      command: "aid-manager.openScript",
      title: "Open Script",
      arguments: [this]
    };
  }
}

class LoadMoreItem extends vscode.TreeItem {
  constructor() {
    super("Load more…", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "loadMore";
    this.iconPath = new vscode.ThemeIcon("chevron-down");
    this.command = {
      command: "aid-manager.loadMoreScenarios",
      title: "Load more…"
    };
  }
}

class InfoItem extends vscode.TreeItem {
  constructor(msg: string) {
    super(msg, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("info");
    this.contextValue = "info";
  }
}
