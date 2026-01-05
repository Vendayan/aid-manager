// src/ScenarioService.ts
import * as vscode from "vscode";
import { AIDClient } from "./AIDClient";
import { LocalStore, ScenarioSnapshot } from "./LocalStore";
import { ScriptEvent, Scenario } from "./AIDTypes";

function sanitizePretty(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "_").trim();
}

function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) + text.charCodeAt(i);
    h = h & 0xffffffff;
  }
  return (h >>> 0).toString(16);
}

async function readText(context: vscode.ExtensionContext, relPath: string): Promise<string> {
  const uri = vscode.Uri.joinPath(context.extensionUri, relPath);
  const data = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(data).toString("utf8");
}

export class ScenarioService {
  private lastScenarioEditedAt = new Map<string, string | null>();
  private lastScriptsHash = new Map<string, string | null>();
  private scenarioStateMeta = new Map<string, { storyCardInstructions: string; storyCardStoryInformation: string; }>();
  private scenarioOverrides = new Map<string, any>();
  private scenarioPanels = new Map<string, vscode.Webview>();
  private storyCardPanels = new Map<string, { shortId: string; cardId: string; webview: vscode.Webview }>();
  private webviewStateWaiters = new WeakMap<vscode.Webview, Map<string, { resolve: (value: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>>();
  // Tree-facing state (owns cache for scenario tree presentation)
  private treeStore = new LocalStore();
  private scenarioInfoCache = new Map<string, { isContainer: boolean; children: Scenario[] }>();
  private treeEmitter = new vscode.EventEmitter<string | undefined>();
  public readonly onDidChangeTreeState = this.treeEmitter.event;
  private pageSize = 100;
  private rootItems: Scenario[] = [];
  private rootOffset = 0;
  private rootEnded = false;
  private rootLoading = false;
  private storyCardCache = new Map<string, Array<{ id: string; title: string; type: string; description: string }>>();

  public constructor(private client: AIDClient) {
    this.treeStore.onDidChange((shortId) => {
      this.treeEmitter.fire(shortId);
    });
  }

  private logStoryCards(msg: string, meta?: Record<string, any>): void {
    const payload = meta ? ` ${JSON.stringify(meta)}` : "";
    console.log(`[aid-manager][story-cards] ${msg}${payload}`);
  }

  private cloneModel<T>(model: T): T {
    return JSON.parse(JSON.stringify(model));
  }

  public setLocalScenarioOverride(shortId: string, model: any): void {
    const clone = this.cloneModel(model ?? {});
    this.scenarioOverrides.set(shortId, clone);
    this.rememberScenarioState(shortId, clone);
  }

  public clearLocalScenarioOverride(shortId: string): void {
    this.scenarioOverrides.delete(shortId);
  }

  public async applyScenarioJsonText(shortId: string, jsonText: string): Promise<void> {
    try {
      const parsed = JSON.parse(jsonText);
      this.setLocalScenarioOverride(shortId, parsed);
    } catch (err: any) {
      throw new Error(`Scenario JSON must be valid JSON: ${err?.message ?? err}`);
    }
  }

  public applyScenarioStateSnapshot(shortId: string, snapshot: { model: any; storyCards?: any[] }): void {
    const model = snapshot?.model ? this.cloneModel(snapshot.model) : {};
    if (Array.isArray(snapshot?.storyCards)) {
      model.storyCards = this.cloneModel(snapshot.storyCards);
    }
    this.setLocalScenarioOverride(shortId, model);
  }

  // ---------- Scenario tree state (caching + events) ----------

  public resetTreeState(): void {
    this.rootItems = [];
    this.rootOffset = 0;
    this.rootEnded = false;
    this.rootLoading = false;
    this.scenarioInfoCache.clear();
    this.storyCardCache.clear();
    this.treeStore.resetAll();
    this.treeEmitter.fire(undefined);
  }

  public getRootView(): { items: Scenario[]; hasMore: boolean; loading: boolean } {
    return {
      items: this.rootItems,
      hasMore: !this.rootEnded,
      loading: this.rootLoading
    };
  }

  public async loadMoreRoot(): Promise<void> {
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
      this.treeEmitter.fire(undefined);
    } finally {
      this.rootLoading = false;
    }
  }

  public async getScenarioInfoCached(shortId: string): Promise<{ isContainer: boolean; children: Scenario[] }> {
    let info = this.scenarioInfoCache.get(shortId);
    if (!info) {
      info = await this.client.getScenarioInfo(shortId);
      this.scenarioInfoCache.set(shortId, info);
    }
    return info;
  }

  public async getScriptSnapshotForTree(shortId: string): Promise<ScenarioSnapshot | undefined> {
    const forceReload = this.treeStore.consumeServerReload(shortId);
    let snapshot = this.treeStore.getSnapshot(shortId);

    if (forceReload || !snapshot) {
      const s = await this.client.getScenarioScripting(shortId);
      snapshot = {
        sharedLibrary: s.gameCodeSharedLibrary ?? null,
        onInput: s.gameCodeOnInput ?? null,
        onOutput: s.gameCodeOnOutput ?? null,
        onModelContext: s.gameCodeOnModelContext ?? null
      };
      this.treeStore.setSnapshot(shortId, snapshot);
    }

    return snapshot;
  }

  public effectiveScriptExists(shortId: string, ev: ScriptEvent): boolean {
    return this.treeStore.effectiveExists(shortId, ev);
  }

  public async getStoryCardsForTree(
    shortId: string,
    opts?: { force?: boolean; retryIfEmpty?: boolean }
  ): Promise<Array<{ id: string; title: string; type: string; description: string }>> {
    const force = !!opts?.force;
    const retryIfEmpty = !!opts?.retryIfEmpty;

    // Prefer local override if present, unless forcing server.
    if (!force) {
      const override = this.scenarioOverrides.get(shortId);
      if (override?.storyCards && Array.isArray(override.storyCards)) {
        const mapped = this.mapStoryCardsForTree(override.storyCards);
        this.storyCardCache.set(shortId, mapped);
        this.logStoryCards("using override story cards", { shortId, count: mapped.length });
        return mapped;
      }
    }

    if (!force) {
      const cached = this.storyCardCache.get(shortId);
      if (cached) {
        this.logStoryCards("using cached story cards", { shortId, count: cached.length });
        return cached;
      }
    } else {
      this.storyCardCache.delete(shortId);
    }

    const fetchOnce = async (): Promise<Array<{ id: string; title: string; type: string; description: string }>> => {
      const raw = await this.fetchScenario(shortId);
      const mappedTree = this.mapStoryCardsForTree(raw?.storyCards ?? []);
      const mappedWebview = this.mapStoryCardsForWebview(raw?.storyCards ?? []);
      this.storyCardCache.set(shortId, mappedTree);
      this.logStoryCards("fetched story cards from server", { shortId, count: mappedTree.length });
      this.notifyStoryCardsChanged(shortId, mappedTree, mappedWebview);
      return mappedTree;
    };

    let mapped = await fetchOnce();
    if (retryIfEmpty && mapped.length === 0) {
      await new Promise((res) => setTimeout(res, 300));
      mapped = await fetchOnce();
    }
    return mapped;
  }

  public async copyStoryCardBetweenScenarios(sourceShortId: string, cardId: string, targetShortId: string): Promise<void> {
    const card = await this.getStoryCardDetail(sourceShortId, cardId);
    if (!card) {
      throw new Error("Story card not found.");
    }
    const created = await this.createStoryCardSafe(targetShortId, {
      title: card.title,
      type: card.type,
      description: card.description,
      body: card.body,
      keys: card.keys,
      useForCharacterCreation: card.useForCharacterCreation
    });
    if (!created) {
      throw new Error("Copy failed. The server may not support story card creation.");
    }
    this.logStoryCards("copied story card", { from: sourceShortId, to: targetShortId, cardId });
    await this.addStoryCardToCache(targetShortId, created);
  }

  public async deleteStoryCard(shortId: string, cardId: string): Promise<void> {
    const ok = await this.deleteStoryCardSafe(shortId, cardId);
    if (!ok) {
      throw new Error("Delete failed. The server may not support story card deletion.");
    }
    this.logStoryCards("deleted story card", { shortId, cardId });
    await this.removeStoryCardFromCache(shortId, cardId);
  }

  public async updateStoryCard(shortId: string, cardId: string, patch: any): Promise<void> {
    const updated = await this.updateStoryCardSafe(shortId, cardId, patch);
    if (!updated) {
      throw new Error("Update failed. The server may not support story card updates.");
    }
    await this.addStoryCardToCache(shortId, updated);
  }

  public refreshStoryCards(shortId: string): void {
    this.storyCardCache.delete(shortId);
    this.logStoryCards("refreshing story cards", { shortId });
    this.treeEmitter.fire(shortId);
  }

  public async forceRefreshStoryCards(shortId: string): Promise<void> {
    this.logStoryCards("force refreshing story cards", { shortId });
    await this.getStoryCardsForTree(shortId, { force: true, retryIfEmpty: true });
    this.treeEmitter.fire(shortId);
  }

  public markScriptExists(shortId: string, event: ScriptEvent): void {
    this.treeStore.setOverride(shortId, event, "exists");
  }

  public markScriptMissing(shortId: string, event: ScriptEvent): void {
    this.treeStore.setOverride(shortId, event, "missing");
  }

  public setServerScriptSnapshot(shortId: string, snap: ScenarioSnapshot): void {
    this.treeStore.setSnapshot(shortId, snap);
  }

  public clearOverridesForScenario(shortId: string): void {
    this.treeStore.clearOverrides(shortId);
  }

  public requestServerReload(shortId: string): void {
    this.treeStore.clearSnapshot(shortId);
    this.treeStore.clearOverrides(shortId);
    this.treeStore.requestServerReload(shortId);
    this.scenarioInfoCache.delete(shortId);
    this.storyCardCache.delete(shortId);
    this.scenarioOverrides.delete(shortId);
    this.logStoryCards("requestServerReload", { shortId });
    this.treeEmitter.fire(shortId);
  }

  public requestLocalRefresh(shortId: string): void {
    this.treeStore.requestLocalRefresh(shortId);
  }

  public async getEditorJson(shortId: string): Promise<any> {
    const override = this.scenarioOverrides.get(shortId);
    if (override) {
      const clone = this.cloneModel(override);
      this.rememberScenarioState(shortId, clone);
      return clone;
    }
    const raw = await this.fetchScenario(shortId);
    const normalized = this.normalizeEditorJson(raw);
    this.rememberScenarioState(shortId, normalized);
    return normalized;
  }

  public async getExportJson(shortId: string): Promise<any> {
    const override = this.scenarioOverrides.get(shortId);
    if (override) {
      return this.cloneModel(override);
    }
    const raw = await this.fetchScenario(shortId);
    const normalized = this.normalizeExportJson(raw);
    this.rememberScenarioState(shortId, normalized);
    return normalized;
  }

  // multipleChoice = container (no scripts). Others are leaves.
  public async isMultipleChoice(shortId: string): Promise<boolean> {
    const raw = await this.fetchScenario(shortId);
    const type = (raw?.type || "").toString();
    if (type === "multipleChoice") {
      return true;
    }
    return false;
  }

  public async exportScenario(shortId: string, scenarioTitle: string): Promise<void> {
    const dest = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select folder"
    });
    if (!dest || dest.length === 0) {
      return;
    }
    const dstFolder = dest[0];

    const info = await this.fetchScenario(shortId);
    const isContainer = await this.isMultipleChoice(shortId);

    if (isContainer) {
      const options = Array.isArray(info?.options) ? info.options : [];
      const children = options.filter((o: any) => {
        if (!o) {
          return false;
        }
        if (o.shortId === info?.shortId) {
          return false;
        }
        if (o.parentScenarioId === null) {
          return false;
        }
        return true;
      });

      if (children.length === 0) {
        vscode.window.showInformationMessage(`No options to export for “${scenarioTitle}”.`);
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Export ${children.length} option${children.length === 1 ? "" : "s"} from “${scenarioTitle}”? This will create one subfolder per option with 4 files and a scenario.json in each.`,
        { modal: true },
        "Export Options",
        "Cancel"
      );
      if (confirm !== "Export Options") {
        return;
      }

      for (const child of children) {
        const folderName = sanitizePretty(`${child.title} (${child.shortId})`);
        const childDir = vscode.Uri.joinPath(dstFolder, folderName);
        await vscode.workspace.fs.createDirectory(childDir);

        const s = await this.client.getScenarioScripting(child.shortId);
        const files: Array<{ name: string; text: string }> = [
          { name: "Shared Library.js", text: s.gameCodeSharedLibrary ?? "" },
          { name: "Input.js", text: s.gameCodeOnInput ?? "" },
          { name: "Output.js", text: s.gameCodeOnOutput ?? "" },
          { name: "Context.js", text: s.gameCodeOnModelContext ?? "" }
        ];
        for (const f of files) {
          const fname = sanitizePretty(f.name);
          const target = vscode.Uri.joinPath(childDir, fname);
          if (await this.fileExists(target)) {
            const choice = await vscode.window.showWarningMessage(
              `File exists: ${folderName}/${fname}. Overwrite?`,
              { modal: true },
              "Overwrite",
              "Skip"
            );
            if (choice !== "Overwrite") {
              continue;
            }
          }
          await vscode.workspace.fs.writeFile(target, Buffer.from(f.text, "utf8"));
        }

        const normalized = await this.getExportJson(child.shortId);
        const json = JSON.stringify(normalized, null, 2);
        const jsonUri = vscode.Uri.joinPath(childDir, "scenario.json");
        if (await this.fileExists(jsonUri)) {
          const choice = await vscode.window.showWarningMessage(
            `File exists: ${folderName}/scenario.json. Overwrite?`,
            { modal: true },
            "Overwrite",
            "Skip"
          );
          if (choice !== "Overwrite") {
            continue;
          }
        }
        await vscode.workspace.fs.writeFile(jsonUri, Buffer.from(json, "utf8"));
      }

      vscode.window.showInformationMessage(
        `Exported ${children.length} option${children.length === 1 ? "" : "s"} from “${scenarioTitle}”.`
      );
      return;
    }

    // Leaf scenario
    const s = await this.client.getScenarioScripting(shortId);
    const files: Array<{ name: string; text: string }> = [
      { name: "Shared Library.js", text: s.gameCodeSharedLibrary ?? "" },
      { name: "Input.js", text: s.gameCodeOnInput ?? "" },
      { name: "Output.js", text: s.gameCodeOnOutput ?? "" },
      { name: "Context.js", text: s.gameCodeOnModelContext ?? "" }
    ];
    for (const f of files) {
      const fname = sanitizePretty(f.name);
      const target = vscode.Uri.joinPath(dstFolder, fname);
      if (await this.fileExists(target)) {
        const choice = await vscode.window.showWarningMessage(
          `File exists: ${fname}. Overwrite?`,
          { modal: true },
          "Overwrite",
          "Skip"
        );
        if (choice !== "Overwrite") {
          continue;
        }
      }
      await vscode.workspace.fs.writeFile(target, Buffer.from(f.text, "utf8"));
    }

    const normalized = await this.getExportJson(shortId);
    const json = JSON.stringify(normalized, null, 2);
    const jsonUri = vscode.Uri.joinPath(dstFolder, "scenario.json");
    if (await this.fileExists(jsonUri)) {
      const choice = await vscode.window.showWarningMessage(
        `File exists: scenario.json. Overwrite?`,
        { modal: true },
        "Overwrite",
        "Skip"
      );
      if (choice === "Overwrite") {
        await vscode.workspace.fs.writeFile(jsonUri, Buffer.from(json, "utf8"));
      }
    } else {
      await vscode.workspace.fs.writeFile(jsonUri, Buffer.from(json, "utf8"));
    }

    vscode.window.showInformationMessage(`Exported scripts and scenario.json for “${scenarioTitle}”.`);
  }

  /**
   * Returns true when the server reports a different `editedAt` or script hash than
   * the last refresh. The refresh command uses this to decide whether it must close
   * local editors to avoid overwriting newer server content.
   */
  public async shouldPurgeOnRefresh(shortId: string): Promise<boolean> {
    try {
      const serverScenario = await this.fetchScenario(shortId);
      const serverEdited = serverScenario?.editedAt ?? null;

      const s = await this.client.getScenarioScripting(shortId);
      const hash = hashText(
        (s.gameCodeSharedLibrary ?? "") +
        "§" + (s.gameCodeOnInput ?? "") +
        "§" + (s.gameCodeOnOutput ?? "") +
        "§" + (s.gameCodeOnModelContext ?? "")
      );

      const prevEdited = this.lastScenarioEditedAt.get(shortId) ?? null;
      const prevHash = this.lastScriptsHash.get(shortId) ?? null;

      const changed = (serverEdited !== prevEdited) || (hash !== prevHash);

      this.lastScenarioEditedAt.set(shortId, serverEdited);
      this.lastScriptsHash.set(shortId, hash);

      return changed;
    } catch {
      return true;
    }
  }

  // ---------- Webview shell from resources ----------

  public async renderEditorUI(context: vscode.ExtensionContext, webview: vscode.Webview): Promise<string> {
    const distRoot = vscode.Uri.joinPath(context.extensionUri, "media", "scenario", "dist");
    let html = await readText(context, "media/scenario/dist/index.html");

    const csp = [
      "default-src 'none';",
      `img-src ${webview.cspSource} https: data:;`,
      `style-src ${webview.cspSource} 'unsafe-inline';`,
      `script-src ${webview.cspSource} 'unsafe-inline';`,
      `font-src ${webview.cspSource};`
    ].join(" ");

    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    if (html.includes("</head>")) {
      html = html.replace("</head>", `${cspMeta}</head>`);
    } else {
      html = cspMeta + html;
    }

    const assetRegex = /(src|href)="([^"]+)"/g;
    const toUri = (assetPath: string): string => {
      if (/^https?:/i.test(assetPath) || assetPath.startsWith("data:") || assetPath.startsWith("vscode-webview://")) {
        return assetPath;
      }
      const normalized = assetPath.replace(/^\/+/, "").replace(/^\.\//, "");
      const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, normalized));
      return assetUri.toString();
    };

    return html.replace(assetRegex, (_match, attr, value) => `${attr}="${toUri(value)}"`);
  }

  public async renderStoryCardUI(context: vscode.ExtensionContext, webview: vscode.Webview): Promise<string> {
    const distRoot = vscode.Uri.joinPath(context.extensionUri, "media", "scenario", "dist");
    let html = await readText(context, "media/scenario/dist/story-card.html");

    const csp = [
      "default-src 'none';",
      `img-src ${webview.cspSource} https: data:;`,
      `style-src ${webview.cspSource} 'unsafe-inline';`,
      `script-src ${webview.cspSource};`,
      `font-src ${webview.cspSource};`
    ].join(" ");

    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    if (html.includes("</head>")) {
      html = html.replace("</head>", `${cspMeta}</head>`);
    } else {
      html = cspMeta + html;
    }

    const assetRegex = /(src|href)="([^"]+)"/g;
    const toUri = (assetPath: string): string => {
      if (/^https?:/i.test(assetPath) || assetPath.startsWith("data:") || assetPath.startsWith("vscode-webview://")) {
        return assetPath;
      }
      const normalized = assetPath.replace(/^\/+/, "").replace(/^\.\//, "");
      const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, normalized));
      return assetUri.toString();
    };

    return html.replace(assetRegex, (_match, attr, value) => `${attr}="${toUri(value)}"`);
  }

  // ---------- Normalization ----------

  private normalizeEditorJson(model: any): any {
    if (!model) {
      return {};
    }
    const base = this.baseScenarioFields(model);
    base.options = this.shallowOptions(model);
    base.storyCards = this.storyCards(model);
    base.state = this.stateFields(model);
    base.published = model.published ?? false;
    base.unlisted = model.unlisted ?? false;
    base.allowComments = model.allowComments ?? true;
    base.showComments = model.showComments ?? false;
    base.contentType = base.contentType || "Unrated";
    base.contentRatingLockedAt = model.contentRatingLockedAt ?? null;
    base.contentRatingLockedMessage = model.contentRatingLockedMessage ?? null;
    base.blockedAt = model.blockedAt ?? null;
    base.deletedAt = model.deletedAt ?? null;
    return base;
  }

  private normalizeExportJson(model: any): any {
    if (!model) {
      return {};
    }
    const base = this.baseScenarioFields(model);
    base.options = this.shallowOptions(model);
    base.storyCards = this.storyCards(model);
    base.state = this.stateFields(model);
    base.published = model.published ?? false;
    base.unlisted = model.unlisted ?? false;
    base.contentType = model.contentType ?? "Unrated";
    base.allowComments = model.allowComments ?? true;
    base.showComments = model.showComments ?? false;
    base.contentRatingLockedAt = model.contentRatingLockedAt ?? null;
    base.contentRatingLockedMessage = model.contentRatingLockedMessage ?? null;
    base.blockedAt = model.blockedAt ?? null;
    base.deletedAt = model.deletedAt ?? null;
    return base;
  }

  private baseScenarioFields(model: any): any {
    return {
      id: model.id,
      contentType: model.contentType ?? "scenario", // not rendered
      createdAt: model.createdAt ?? null,
      editedAt: model.editedAt ?? null,
      shortId: model.shortId,
      publicId: model.publicId ?? null,
      title: model.title ?? "",
      description: model.description ?? "",
      prompt: model.prompt ?? "",
      memory: model.memory ?? "",
      authorsNote: model.authorsNote ?? "",
      image: model.image ?? null,
      type: model.type ?? null, // not rendered;
      contentRating: model.contentRating ?? "Unrated",
      nsfw: model.nsfw ?? null,
      tags: Array.isArray(model.tags) ? model.tags.slice() : [],
      parentScenario: model.parentScenario
        ? {
          id: model.parentScenario.id,
          shortId: model.parentScenario.shortId,
          title: model.parentScenario.title
        }
        : null
    };
  }

  private stateFields(model: any): any {
    const state = model?.state ?? {};
    return {
      scenarioId: state?.scenarioId ?? null,
      type: state?.type ?? null,
      storySummary: state?.storySummary ?? "",
      storyCardInstructions: state?.storyCardInstructions ?? "",
      storyCardStoryInformation: state?.storyCardStoryInformation ?? "",
      scenarioStateVersion: state?.scenarioStateVersion ?? null,
      instructions: state?.instructions ?? {}
    };
  }

  private shallowOptions(model: any): any[] {
    const headerShortId = model?.shortId;
    const allOptions = Array.isArray(model?.options) ? model.options : [];
    const options = allOptions
      .filter((o: any) => {
        if (!o) {
          return false;
        }
        if (o.shortId === headerShortId) {
          return false;
        }
        if (o.parentScenarioId === null) {
          return false;
        }
        return true;
      })
      .map((o: any) => ({
        id: o.id,
        shortId: o.shortId,
        title: o.title,
        prompt: o.prompt ?? "",
        parentScenarioId: o.parentScenarioId
      }));
    return options;
  }

  private storyCards(model: any): any[] {
    const storyCards = Array.isArray(model?.storyCards)
      ? model.storyCards.map((sc: any) => ({
        id: sc.id,
        updatedAt: sc.updatedAt,
        deletedAt: sc.deletedAt ?? null,
        keys: sc.keys ?? null,
        value: sc.value ?? null,
        type: sc.type ?? null,
        title: sc.title ?? null,
        description: sc.description ?? null,
        useForCharacterCreation: !!sc.useForCharacterCreation,
        userId: sc.userId ?? null,
        factionName: sc.factionName ?? null
      }))
      : [];
    return storyCards;
  }

  private rememberScenarioState(shortId: string, normalized: any): void {
    const state = normalized?.state;
    if (!state) {
      return;
    }
    this.scenarioStateMeta.set(shortId, {
      storyCardInstructions: state.storyCardInstructions ?? "",
      storyCardStoryInformation: state.storyCardStoryInformation ?? ""
    });
  }

  private async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private async fetchScenario(shortId: string): Promise<any> {
    const anyClient: any = this.client as any;
    if (typeof anyClient.getScenarioFull === "function") {
      return await anyClient.getScenarioFull(shortId);
    }
    if (typeof anyClient.getScenario === "function") {
      return await anyClient.getScenario(shortId);
    }
    if (typeof anyClient.fetchScenario === "function") {
      return await anyClient.fetchScenario(shortId);
    }
    throw new Error("AIDClient is missing getScenarioFull/getScenario.");
  }

  public async sendScenarioInit(webview: vscode.Webview, shortId: string): Promise<void> {
    this.scenarioPanels.set(shortId, webview);
    const model = await this.getEditorJson(shortId);

    // Plot components may require a details call; handle best-effort.
    const plotComponents = await this.getPlotComponentsSafe(shortId);

    // Story cards → shape the webview expects
    const storyCards = this.mapStoryCardsForWebview(model?.storyCards ?? []);

    webview.postMessage({
      type: "scenario:init",
      model,
      plotComponents,
      storyCards
    });
  }

  public async sendStoryCardInit(webview: vscode.Webview, shortId: string, cardId: string): Promise<void> {
    // Always fetch fresh for single-card panels to avoid stale overrides.
    const card = await this.getStoryCardDetail(shortId, cardId, { forceServer: true });
    if (!card) {
      console.warn(`[aid-manager][story-card] init: card not found`, { shortId, cardId });
      webview.postMessage({ type: "storyCard:deleted" });
      return;
    }
    this.storyCardPanels.set(`${shortId}:${cardId}`, { shortId, cardId, webview });
    console.log(`[aid-manager][story-card] init: sending card`, { shortId, cardId, card });
    webview.postMessage({ type: "storyCard:set", card: this.mapStoryCardsForWebview([card])[0] });
  }

  /**
   * Wires message handlers for the scenario editor webview.
   * Returns a Disposable; call .dispose() when the panel closes.
   */
  public attachWebviewHandlers(
    webview: vscode.Webview,
    shortId: string,
    opts?: { onDirtyChange?: (dirty: boolean) => void }
  ): vscode.Disposable {
    const pending = new Map<string, { resolve: (value: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();
    this.webviewStateWaiters.set(webview, pending);
    const sub = webview.onDidReceiveMessage(async (msg: any) => {
      try {
        switch (msg?.type) {
          case "scenario:ready": {
            await this.sendScenarioInit(webview, shortId);
            break;
          }
          case "scenario:dirty": {
            if (typeof msg?.dirty === "boolean") {
              opts?.onDirtyChange?.(!!msg.dirty);
            }
            break;
          }
          case "scenario:state": {
            const reqId = typeof msg?.requestId === "string" ? msg.requestId : "";
            if (!reqId) { break; }
            const waiter = pending.get(reqId);
            if (waiter) {
              pending.delete(reqId);
              clearTimeout(waiter.timer);
              waiter.resolve(msg?.payload ?? {});
            }
            break;
          }

          case "storycard:create": {
            const payload = msg?.payload || {};
            const created = await this.createStoryCardSafe(shortId, {
              title: payload?.title,
              type: payload?.type,
              body: payload?.body,
              description: payload?.description,
              keys: payload?.keys,
              useForCharacterCreation: payload?.useForCharacterCreation
            });
            if (!created) {
              vscode.window.showWarningMessage("Failed to create story card. Please try again.");
              break;
            }
            this.addStoryCardToCache(shortId, created);
            break;
          }

          case "storycard:delete": {
            if (!msg?.id) { break; }
            const ok = await this.deleteStoryCardSafe(shortId, msg.id);
            if (!ok) {
              vscode.window.showWarningMessage("Failed to delete story card. Please try again.");
              break;
            }
            this.removeStoryCardFromCache(shortId, msg.id);
            break;
          }

          case "storycard:update": {
            // Debounced on the webview, but we still guard here.
            const id = msg?.id;
            const patch = msg?.patch || {};
            if (!id) { break; }

            // Convert webview patch → API shape (value for body)
            const apiPatch: any = { ...patch };
            if ("body" in apiPatch) {
              apiPatch.value = apiPatch.body;
              delete apiPatch.body;
            }

            const ok = await this.updateStoryCardSafe(shortId, id, apiPatch);
            if (!ok) {
              vscode.window.showWarningMessage("Failed to update story card.");
            }
            break;
          }
          case "scenario:save": {
            try {
              const snapshot = msg?.payload ?? {};
              const saved = await this.saveScenarioSnapshot(shortId, snapshot);
              webview.postMessage({
                type: "scenario:saved",
                model: saved,
                storyCards: this.mapStoryCardsForWebview(saved?.storyCards ?? [])
              });
              opts?.onDirtyChange?.(false);
            } catch (err: any) {
              webview.postMessage({
                type: "scenario:save:error",
                message: err?.message ?? String(err)
              });
              vscode.window.showErrorMessage(`Failed to save scenario: ${err?.message ?? err}`);
            }
            break;
          }

          default:
            // Unknown message type—ignore.
            break;
        }
      } catch (err: any) {
        console.error("Scenario webview message error:", err);
        vscode.window.showErrorMessage(`Scenario editor error: ${err?.message ?? err}`);
      }
    });

    return new vscode.Disposable(() => {
      sub.dispose();
      this.webviewStateWaiters.delete(webview);
      for (const [key, waiter] of pending.entries()) {
        pending.delete(key);
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Scenario editor closed before responding."));
      }
      this.scenarioPanels.forEach((wv, key) => {
        if (wv === webview) {
          this.scenarioPanels.delete(key);
        }
      });
    });
  }

  public attachStoryCardWebviewHandlers(webview: vscode.Webview, shortId: string, cardId: string): vscode.Disposable {
    const sub = webview.onDidReceiveMessage(async (msg: any) => {
      try {
        switch (msg?.type) {
          case "storyCard:ready": {
            console.log("[aid-manager][story-card] ready message received", { shortId, cardId });
            await this.sendStoryCardInit(webview, shortId, cardId);
            break;
          }
          case "storyCard:update": {
            const patch = msg?.patch || {};
            try {
              await this.updateStoryCard(shortId, cardId, patch);
              const latest = await this.getStoryCardDetail(shortId, cardId);
              if (latest) {
                webview.postMessage({ type: "storyCard:set", card: this.mapStoryCardsForWebview([latest])[0] });
              }
            } catch (err: any) {
              webview.postMessage({ type: "storyCard:error", message: err?.message ?? String(err) });
            }
            break;
          }
          case "storyCard:delete": {
            try {
              await this.deleteStoryCard(shortId, cardId);
              webview.postMessage({ type: "storyCard:deleted" });
            } catch (err: any) {
              webview.postMessage({ type: "storyCard:error", message: err?.message ?? String(err) });
            }
            break;
          }
          default:
            break;
        }
      } catch (err: any) {
        webview.postMessage({ type: "storyCard:error", message: err?.message ?? String(err) });
      }
    });

    return new vscode.Disposable(() => {
      sub.dispose();
      const key = `${shortId}:${cardId}`;
      this.storyCardPanels.delete(key);
    });
  }

  public async requestScenarioState(webview: vscode.Webview): Promise<{ model: any; storyCards?: any[] }> {
    const pending = this.webviewStateWaiters.get(webview);
    if (!pending) {
      throw new Error("Scenario editor is not ready.");
    }
    const requestId = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Timed out waiting for scenario state."));
      }, 5000);
      pending.set(requestId, {
        resolve: (value) => resolve(value),
        reject,
        timer
      });
      webview.postMessage({ type: "scenario:requestState", requestId });
    });
  }

  /* ---------- helpers ---------- */

  public mapStoryCardsForWebview(items: any[]): Array<{ id: string; title: string; type: string; keys: string; body: string; description: string; useForCharacterCreation: boolean }> {
    return (items || []).map((sc: any) => ({
      id: sc.id,
      title: sc.title ?? "",
      type: sc.type ?? "card",
      keys: sc.keys ?? "",
      body: String(sc.body ?? sc.value ?? ""),
      description: String(sc.description ?? ""),
      useForCharacterCreation: !!sc.useForCharacterCreation
    }));
  }

  private mapStoryCardsForTree(items: any[]): Array<{ id: string; title: string; type: string; description: string }> {
    return (items || [])
      .filter(Boolean)
      .map((sc: any) => ({
        id: sc.id ?? "",
        title: (sc.title ?? sc.name ?? "Untitled").toString(),
        type: (sc.type ?? "custom").toString(),
        description: (sc.description ?? "").toString()
      }))
      .filter((sc) => sc.id || sc.title);
  }

  public async getStoryCardDetail(shortId: string, cardId: string, opts?: { forceServer?: boolean }): Promise<{
    id: string;
    title: string;
    type: string;
    description: string;
    keys: string;
    body: string;
    useForCharacterCreation: boolean;
  } | null> {
    const override = this.scenarioOverrides.get(shortId);
    const findCard = (items: any[]) => {
      for (const sc of items || []) {
        if (!sc) continue;
        if (sc.id === cardId) {
          return {
            id: sc.id ?? "",
            title: (sc.title ?? sc.name ?? "Untitled").toString(),
            type: (sc.type ?? "custom").toString(),
            description: (sc.description ?? "").toString(),
            keys: (sc.keys ?? "").toString(),
            body: String(sc.value ?? ""),
            useForCharacterCreation: !!sc.useForCharacterCreation
          };
        }
      }
      return null;
    };

    const forceServer = !!opts?.forceServer;

    if (!forceServer) {
      if (override?.storyCards && Array.isArray(override.storyCards)) {
        const found = findCard(override.storyCards);
        if (found) { return found; }
      }
    }

    const raw = await this.fetchScenario(shortId);
    return findCard(raw?.storyCards ?? []) ?? null;
  }

  private async addStoryCardToCache(shortId: string, card: any): Promise<void> {
    const mappedTree = this.mapStoryCardsForTree([card]);
    if (!mappedTree.length) {
      return;
    }
    const existing = this.storyCardCache.get(shortId) ?? [];
    const deduped = existing.filter((c) => c.id !== mappedTree[0].id);
    const next = [...deduped, mappedTree[0]];
    this.storyCardCache.set(shortId, next);
    this.treeEmitter.fire(shortId);
    // Fetch full data to populate keys/body for webviews and keep cache accurate.
    await this.forceRefreshStoryCards(shortId);
  }

  private async removeStoryCardFromCache(shortId: string, cardId: string): Promise<void> {
    const existing = this.storyCardCache.get(shortId);
    if (!existing) {
      await this.forceRefreshStoryCards(shortId);
      return;
    }
    const next = existing.filter((c) => c.id !== cardId);
    this.storyCardCache.set(shortId, next);
    this.treeEmitter.fire(shortId);
    await this.forceRefreshStoryCards(shortId);
  }

  private notifyStoryCardsChanged(
    shortId: string,
    treeCards: Array<{ id: string; title: string; type: string; description: string }>,
    webviewCards?: Array<{ id: string; title: string; type: string; keys: string; body: string; description: string; useForCharacterCreation: boolean }>
  ): void {
    const webview = this.scenarioPanels.get(shortId);
    if (webview) {
      webview.postMessage({
        type: "storyCards:set",
        storyCards: webviewCards ?? this.mapStoryCardsForWebview(treeCards)
      });
    }

    // Update any standalone story card panels for this scenario.
    if (this.storyCardPanels.size > 0) {
      const byId = new Map<string, any>();
      if (webviewCards) {
        for (const c of webviewCards) {
          byId.set(c.id, c);
        }
      } else {
        for (const c of this.mapStoryCardsForWebview(treeCards)) {
          byId.set(c.id, c);
        }
      }
      for (const [key, entry] of this.storyCardPanels.entries()) {
        if (entry.shortId !== shortId) {
          continue;
        }
        const card = byId.get(entry.cardId);
        if (card) {
          entry.webview.postMessage({ type: "storyCard:set", card });
        } else {
          entry.webview.postMessage({ type: "storyCard:deleted" });
        }
      }
    }
  }

  private async getPlotComponentsSafe(shortId: string): Promise<Record<string, { type: string; text: string }>> {
    try {
      const anyClient: any = this.client as any;
      if (typeof anyClient.getScenarioDetails !== "function") {
        return {};
      }
      const details = await anyClient.getScenarioDetails(shortId);
      const out: Record<string, { type: string; text: string }> = {};

      const pcs = (details?.plotComponents ?? []) as any;
      if (Array.isArray(pcs)) {
        for (const pc of pcs) {
          const t = String(pc?.type ?? "").trim();
          if (!t) {
            continue;
          }
          out[t] = { type: t, text: String(pc?.text ?? "") };
        }
      } else if (pcs && typeof pcs === "object") {
        for (const [k, v] of Object.entries(pcs)) {
          const t = String((v as any)?.type ?? k);
          out[t] = { type: t, text: String((v as any)?.text ?? "") };
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  public async saveScenarioSnapshot(shortId: string, snapshot: { model: any }): Promise<any> {
    if (!snapshot?.model) {
      throw new Error("Missing scenario data.");
    }
    const input = this.buildScenarioUpdateInput(shortId, snapshot.model);
    await this.client.updateScenario(input);
    const refreshed = await this.fetchScenario(shortId);
    const normalized = this.normalizeEditorJson(refreshed);
    this.setLocalScenarioOverride(shortId, normalized);
    return normalized;
  }

  private buildScenarioUpdateInput(shortId: string, model: any): {
    shortId: string;
    title?: string;
    description?: string;
    prompt?: string;
    memory?: string;
    authorsNote?: string;
    tags?: string[];
    contentRating?: string | null;
    allowComments?: boolean;
    details?: Record<string, unknown>;
  } {
    const tags = Array.isArray(model?.tags)
      ? model.tags.filter((tag: any) => typeof tag === "string").map((tag: string) => tag.trim())
      : [];
    const state = (model?.state && typeof model.state === "object") ? { ...model.state } : {};
    const instructions = (state?.instructions && typeof state.instructions === "object")
      ? { ...(state.instructions as Record<string, unknown>) }
      : {};

    return {
      shortId,
      title: model?.title ?? "",
      description: model?.description ?? "",
      prompt: model?.prompt ?? "",
      memory: model?.memory ?? "",
      authorsNote: model?.authorsNote ?? "",
      tags,
      contentRating: model?.contentRating ?? "Unrated",
      allowComments: typeof model?.allowComments === "boolean" ? model.allowComments : undefined,
      details: {
        scenarioId: state?.scenarioId ?? model?.id ?? null,
        instructions,
        storySummary: state?.storySummary ?? "",
        storyCardInstructions: state?.storyCardInstructions ?? "",
        storyCardStoryInformation: state?.storyCardStoryInformation ?? ""
      }
    };
  }

  /* These three wrappers call into AIDClient if the methods exist.
     They return false if the client doesn't support the operation. */

  private getStoryCardContext(shortId: string): { storyCardInstructions: string; storyCardStoryInformation: string; } {
    return this.scenarioStateMeta.get(shortId) ?? { storyCardInstructions: "", storyCardStoryInformation: "" };
  }

  private async createStoryCardSafe(shortId: string, initial?: { title?: string; type?: string; body?: string; description?: string; keys?: string; useForCharacterCreation?: boolean }): Promise<any | null> {
    try {
      const anyClient: any = this.client as any;
      const meta = this.getStoryCardContext(shortId);
      if (typeof anyClient.createStoryCard === "function") {
        const created = await anyClient.createStoryCard({
          shortId,
          contentType: "scenario",
          type: initial?.type || "custom",
          title: initial?.title || "New Story Card",
          description: initial?.description ?? "",
          keys: initial?.keys ?? "",
          value: initial?.body ?? "",
          useForCharacterCreation: initial?.useForCharacterCreation ?? true,
          autoGenerate: false,
          instructions: meta.storyCardInstructions,
          storyInformation: meta.storyCardStoryInformation,
          includeStorySummary: false,
          temperature: 1
        });
        this.clearLocalScenarioOverride(shortId);
        return created;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async updateStoryCardSafe(shortId: string, id: string, patch: any): Promise<any | null> {
    try {
      const anyClient: any = this.client as any;
      if (typeof anyClient.updateStoryCard === "function") {
        const payload = {
          id,
          shortId,
          contentType: "scenario",
          type: patch.type,
          title: patch.title,
          description: patch.description ?? "",
          keys: patch.keys,
          value: typeof patch.value === "string" ? patch.value : (typeof patch.body === "string" ? patch.body : ""),
          useForCharacterCreation: typeof patch.useForCharacterCreation === "boolean"
            ? patch.useForCharacterCreation
            : undefined
        };
        try {
          const res = await anyClient.updateStoryCard(payload);
          this.clearLocalScenarioOverride(shortId);
          return res;
        } catch {
          // ignore and fall through
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async deleteStoryCardSafe(shortId: string, id: string): Promise<boolean> {
    try {
      const anyClient: any = this.client as any;
      if (typeof anyClient.deleteStoryCard === "function") {
        await anyClient.deleteStoryCard({ id, shortId, contentType: "scenario" });
        this.clearLocalScenarioOverride(shortId);
        return true;
      }
      if (typeof anyClient.removeStoryCard === "function") {
        await anyClient.removeStoryCard(id);
        this.clearLocalScenarioOverride(shortId);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

}
