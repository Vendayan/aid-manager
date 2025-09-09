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

  public constructor(private client: AIDClient) { }

  public async getEditorJson(shortId: string): Promise<any> {
    const raw = await this.fetchScenario(shortId);
    return this.normalizeEditorJson(raw);
  }

  public async getExportJson(shortId: string): Promise<any> {
    const raw = await this.fetchScenario(shortId);
    return this.normalizeExportJson(raw);
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
    // Load the HTML template that contains the placeholders: %CSP%, %CSS_URI%, %MAIN_URI%
    const htmlTpl = await readText(context, "media/scenario/scenarioView.html");

    // Entry points that must be served via asWebviewUri
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "scenario", "scenarioView.css") // exact filename/case
    );
    const mainUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "scenario", "scenario-editor.js") // root module under /scenario
    );

    // CSP: allow the VS Code webview origin for scripts/styles; allow inline <style> in custom elements;
    // allow https/data images and the webview origin (for data URLs or extension-served assets).
    const csp = [
      "default-src 'none';",
      `img-src ${webview.cspSource} https: data:;`,
      `style-src ${webview.cspSource} 'unsafe-inline';`,
      `script-src ${webview.cspSource};`
    ].join(" ");

    return htmlTpl
      .replace(/%CSP%/g, csp)
      .replace(/%CSS_URI%/g, cssUri.toString())
      .replace(/%JS_URI%/g, mainUri.toString());
  }

  // ---------- Normalization ----------

  private normalizeEditorJson(model: any): any {
    if (!model) {
      return {};
    }
    const base = this.baseScenarioFields(model);
    base.options = this.shallowOptions(model);
    base.storyCards = this.storyCards(model);
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
    const raw = await this.fetchScenario(shortId);
    const model = this.normalizeEditorJson(raw);

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
  public attachWebviewHandlers(webview: vscode.Webview, shortId: string): vscode.Disposable {
    const sub = webview.onDidReceiveMessage(async (msg: any) => {
      try {
        switch (msg?.type) {
          case "scenario:dirty": {
            // You said persistence comes later; for now we just acknowledge.
            // If you want to log: vscode.window.setStatusBarMessage(`Changed ${msg.field}`, 1000);
            break;
          }

          case "storycard:create": {
            const created = await this.createStoryCardSafe(shortId);
            if (created) {
              const fresh = await this.getEditorJson(shortId);
              webview.postMessage({
                type: "storyCards:set",
                storyCards: this.mapStoryCardsForWebview(fresh?.storyCards ?? [])
              });
            }
            break;
          }

          case "storycard:delete": {
            if (!msg?.id) { break; }
            const ok = await this.deleteStoryCardSafe(msg.id);
            if (ok) {
              const fresh = await this.getEditorJson(shortId);
              webview.postMessage({
                type: "storyCards:set",
                storyCards: this.mapStoryCardsForWebview(fresh?.storyCards ?? [])
              });
            }
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

            const ok = await this.updateStoryCardSafe(id, apiPatch);
            if (!ok) {
              vscode.window.showWarningMessage("Failed to update story card (API method not available).");
            }
            break;
          }

          case "storycard:focus": {
            // FYI-only; no-op here unless you want to highlight something host-side.
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

    return sub;
  }

  /* ---------- helpers ---------- */

  private mapStoryCardsForWebview(items: any[]): Array<{ id: string; title: string; type: string; keys: string; body: string }> {
    return (items || []).map((sc: any) => ({
      id: sc.id,
      title: sc.title ?? "",
      type: sc.type ?? "card",
      keys: sc.keys ?? "",
      body: (sc.value ?? sc.description ?? "") as string
    }));
  }

  private async getPlotComponentsSafe(shortId: string): Promise<Record<string, { type: string; text: string }>> {
    try {
      const anyClient: any = this.client as any;
      if (typeof anyClient.getScenarioDetails !== "function") {
        return {};
      }
      const details = await anyClient.getScenarioDetails(shortId);
      // Support a couple of possible shapes:
      //  - { plotComponents: Array<{ type, text }> }
      //  - { plotComponents: Record<string, { type, text }> }
      const out: Record<string, { type: string; text: string }> = {};

      const pcs = (details?.plotComponents ?? []) as any;
      if (Array.isArray(pcs)) {
        for (const pc of pcs) {
          const t = String(pc?.type ?? "").trim();
          if (!t) { continue; }
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

  /* These three wrappers call into AIDClient if the methods exist.
     They return false if the client doesn't support the operation. */

  private async createStoryCardSafe(shortId: string): Promise<boolean> {
    try {
      const anyClient: any = this.client as any;
      if (typeof anyClient.createStoryCardForScenario === "function") {
        await anyClient.createStoryCardForScenario(shortId);
        return true;
      }
      if (typeof anyClient.createStoryCard === "function") {
        await anyClient.createStoryCard({ shortId });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async updateStoryCardSafe(id: string, patch: any): Promise<boolean> {
    try {
      const anyClient: any = this.client as any;
      if (typeof anyClient.updateStoryCard === "function") {
        // Try common signatures
        try { await anyClient.updateStoryCard(id, patch); return true; } catch { }
        try { await anyClient.updateStoryCard({ id, ...patch }); return true; } catch { }
      }
      return false;
    } catch {
      return false;
    }
  }

  private async deleteStoryCardSafe(id: string): Promise<boolean> {
    try {
      const anyClient: any = this.client as any;
      if (typeof anyClient.deleteStoryCard === "function") {
        await anyClient.deleteStoryCard(id);
        return true;
      }
      if (typeof anyClient.removeStoryCard === "function") {
        await anyClient.removeStoryCard(id);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

}
