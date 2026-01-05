import * as vscode from "vscode";
import { AIDClient } from "./AIDClient";
import { Scenario, Script, FIELD_BY_EVENT, ScriptEvent } from "./AIDTypes";
import { ScenarioService } from "./ScenarioService";

export class ScenarioTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.TreeDragAndDropController<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  readonly dragMimeTypes = ["application/aid-storycard"];
  readonly dropMimeTypes = ["application/aid-storycard"];

  private _scenarioItems = new Map<string, ScenarioItem>(); // shortId -> item

  private pinned: Scenario[] = [];

  constructor(private client: AIDClient, private scenarios: ScenarioService) {
    this.scenarios.onDidChangeTreeState((shortId) => {
      if (!shortId) {
        this._onDidChange.fire(undefined);
        return;
      }
      const node = this._scenarioItems.get(shortId);
      this._onDidChange.fire(node ?? undefined);
    });
  }

  dispose(): void {
    // nothing to dispose currently
  }

  // ----- public API -----

  refresh() {
    this._scenarioItems.clear();
    this.scenarios.resetTreeState();
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
    await this.scenarios.loadMoreRoot();
  }

  getTreeItem(el: vscode.TreeItem) { return el; }

  async getChildren(el?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    try {
      if (!el) {
        // Don't hit the API if auth isn't valid. This never prompts.
        if (typeof (this.client as any).preflightAuth === "function") {
          const state = await (this.client as any).preflightAuth();
          if (state !== "valid") {
            return [];
          }
        }

        let root = this.scenarios.getRootView();
        if (!root.items.length && root.hasMore && !root.loading) {
          await this.loadMoreRoot();
          root = this.scenarios.getRootView();
        }
        if (!root.items.length && !root.hasMore) {
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
        for (const s of root.items) {
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
        if (root.hasMore) {
          items.push(new LoadMoreItem());
        }
        return items;
      }

      if (el instanceof ScenarioItem) {
        const shortId = el.data.shortId;
        const scenarioName = el.data.title;

        const info = await this.scenarios.getScenarioInfoCached(shortId);
        const kind: "container" | "leaf" = info.isContainer ? "container" : "leaf";
        const desc = info.isContainer ? `${info.children.length} options` : undefined;

        el.setKind(kind);
        el.description = desc;

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
        try {
          await this.scenarios.getScriptSnapshotForTree(shortId);
        } catch (err: any) {
          const msg = String(err?.message || err);
          const friendly = msg.includes("AUTH")
            ? "Authentication required to load scripts."
            : "Scripts unavailable (not owner or access denied).";
          // Show the warning but still render script rows in a "missing" state.
          const rows = this.rowsFrom(shortId, scenarioName);
          return [new InfoItem(friendly), ...rows];
        }

        const storyCardsFolder = new StoryCardsFolderItem(shortId, scenarioName);
        return [storyCardsFolder, ...this.rowsFrom(shortId, scenarioName)];
      }

      if (el instanceof StoryCardsFolderItem) {
        const cards = await this.scenarios.getStoryCardsForTree(el.shortId);
        if (!cards.length) {
          return [new InfoItem("No story cards for this scenario.")];
        }
        return cards.map(c => new StoryCardItem(el.shortId, el.scenarioName, c));
      }

      return [];
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg === "AUTH_MISSING" || msg === "AUTH_EXPIRED") {
        return [];
      }
      if (el instanceof ScenarioItem) {
        const rows = this.rowsFrom(el.data.shortId, el.data.title);
        return [new InfoItem(`Error: ${msg}`), ...rows];
      }
      return [new InfoItem(`Error: ${msg}`)];
    }
  }

  private rowsFrom(shortId: string, scenarioName: string): vscode.TreeItem[] {
    const defs = [
      { event: "sharedLibrary" as const, name: "Shared Library" },
      { event: "onInput" as const, name: "Input" },
      { event: "onOutput" as const, name: "Output" },
      { event: "onModelContext" as const, name: "Context" },
    ];

    return defs.map(d => {
      const exists = this.scenarios.effectiveScriptExists(shortId, d.event);
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

  async handleDrag(source: readonly vscode.TreeItem[], dataTransfer: vscode.DataTransfer): Promise<void> {
    const card = source.find((item) => item instanceof StoryCardItem) as StoryCardItem | undefined;
    if (!card) {
      return;
    }
    const payload = JSON.stringify({ shortId: card.shortId, cardId: (card as any).cardId });
    dataTransfer.set("application/aid-storycard", new vscode.DataTransferItem(payload));
  }

  async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const item = dataTransfer.get("application/aid-storycard");
    if (!item) {
      return;
    }
    let payload: { shortId: string; cardId: string } | null = null;
    try {
      payload = JSON.parse(item.value);
    } catch {
      return;
    }
    if (!payload?.shortId || !payload?.cardId) {
      return;
    }

    const targetShortId = this.shortIdFromTarget(target);
    if (!targetShortId) {
      return;
    }
    if (targetShortId === payload.shortId) {
      return; // no-op: same scenario
    }

    try {
      await this.scenarios.copyStoryCardBetweenScenarios(payload.shortId, payload.cardId, targetShortId);
      vscode.window.setStatusBarMessage("Story card copied.", 2000);
      const node = this._scenarioItems.get(targetShortId);
      this._onDidChange.fire(node ?? undefined);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to copy story card: ${err?.message ?? err}`);
    }
  }

  private shortIdFromTarget(target?: vscode.TreeItem): string | null {
    if (!target) {
      return null;
    }
    if (target instanceof StoryCardsFolderItem || target instanceof StoryCardItem) {
      return (target as any).shortId ?? null;
    }
    if (target instanceof ScenarioItem) {
      return target.data.shortId;
    }
    return null;
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

class StoryCardsFolderItem extends vscode.TreeItem {
  constructor(public readonly shortId: string, public readonly scenarioName: string) {
    super("Story Cards", vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "storyCardsFolder";
    this.iconPath = new vscode.ThemeIcon("library");
  }
}

class StoryCardItem extends vscode.TreeItem {
  constructor(public readonly shortId: string, public readonly scenarioName: string, card: { id: string; title: string; type: string; description: string }) {
    super(card.title || card.id || "Story Card", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "storyCard";
    this.description = card.type || undefined;
    this.tooltip = card.description
      ? `${card.title || "Story Card"} [${card.type}] — ${card.description}`
      : `${card.title || "Story Card"} [${card.type}]`;
    this.iconPath = new vscode.ThemeIcon("note");
    (this as any).cardId = card.id;
    this.command = {
      command: "aid-manager.openStoryCard",
      title: "Open Story Card",
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
