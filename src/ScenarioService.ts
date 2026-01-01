// src/ScenarioService.ts
import * as vscode from "vscode";
import { AIDClient } from "./AIDClient";

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
  private webviewStateWaiters = new WeakMap<vscode.Webview, Map<string, { resolve: (value: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>>();

  public constructor(private client: AIDClient) { }

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
            const fresh = await this.getEditorJson(shortId);
            webview.postMessage({
              type: "storyCards:set",
              storyCards: this.mapStoryCardsForWebview(fresh?.storyCards ?? [])
            });
            break;
          }

          case "storycard:delete": {
            if (!msg?.id) { break; }
            const ok = await this.deleteStoryCardSafe(shortId, msg.id);
            if (!ok) {
              vscode.window.showWarningMessage("Failed to delete story card. Please try again.");
              break;
            }
            const fresh = await this.getEditorJson(shortId);
            webview.postMessage({
              type: "storyCards:set",
              storyCards: this.mapStoryCardsForWebview(fresh?.storyCards ?? [])
            });
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

  private mapStoryCardsForWebview(items: any[]): Array<{ id: string; title: string; type: string; keys: string; body: string; description: string; useForCharacterCreation: boolean }> {
    return (items || []).map((sc: any) => ({
      id: sc.id,
      title: sc.title ?? "",
      type: sc.type ?? "card",
      keys: sc.keys ?? "",
      body: String(sc.value ?? ""),
      description: String(sc.description ?? ""),
      useForCharacterCreation: !!sc.useForCharacterCreation
    }));
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

  private async createStoryCardSafe(shortId: string, initial?: { title?: string; type?: string; body?: string; description?: string; keys?: string; useForCharacterCreation?: boolean }): Promise<boolean> {
    try {
      const anyClient: any = this.client as any;
      const meta = this.getStoryCardContext(shortId);
      if (typeof anyClient.createStoryCard === "function") {
        await anyClient.createStoryCard({
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
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async updateStoryCardSafe(shortId: string, id: string, patch: any): Promise<boolean> {
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
          value: patch.value ?? "",
          useForCharacterCreation: typeof patch.useForCharacterCreation === "boolean"
            ? patch.useForCharacterCreation
            : undefined
        };
        try {
          await anyClient.updateStoryCard(payload);
          this.clearLocalScenarioOverride(shortId);
          return true;
        } catch {
          // ignore and fall through
        }
      }
      return false;
    } catch {
      return false;
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
