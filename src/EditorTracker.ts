import * as vscode from "vscode";
import { ScenarioService } from "./ScenarioService";
import { ScriptEvent } from "./AIDTypes";

/**
 * Tracks "potential" (missing) scripts that were opened in an editor,
 * so they appear as existing while open, and flip back to missing if
 * the editor closes without a save.
 */
export class EditorTracker {
  private readonly missingDocByUri = new Map<string, { shortId: string; event: ScriptEvent }>();
  private readonly scenarios: ScenarioService;

  public constructor(scenarios: ScenarioService) {
    this.scenarios = scenarios;
  }

  public attach(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.window.tabGroups.onDidChangeTabs(() => {
        const open = this.openAidTabUris();
        for (const [uriKey, meta] of Array.from(this.missingDocByUri.entries())) {
          if (!open.has(uriKey)) {
            this.missingDocByUri.delete(uriKey);
            this.scenarios.markScriptMissing(meta.shortId, meta.event);
          }
        }
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        const uriKey = doc.uri.toString();
      const meta = this.missingDocByUri.get(uriKey);
      if (!meta) {
        return;
      }
      this.missingDocByUri.delete(uriKey);
      this.scenarios.markScriptMissing(meta.shortId, meta.event);
    })
  );
}

  public trackOpenedWhileMissing(uri: vscode.Uri, shortId: string, event: ScriptEvent): void {
    this.missingDocByUri.set(uri.toString(), { shortId, event });
  }

  public clearMissingFlagForOpenTabs(shortId: string, event: ScriptEvent): void {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== "aid") {
        continue;
      }
      const p = this.parseAidUri(doc.uri);
      if (p && p.shortId === shortId && p.event === event) {
        this.missingDocByUri.delete(doc.uri.toString());
      }
    }
  }

  public isAidEditorOpenFor(shortId: string, event: ScriptEvent): boolean {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== "aid") {
        continue;
      }
      const p = this.parseAidUri(doc.uri);
      if (p && p.shortId === shortId && p.event === event) {
        return true;
      }
    }
    return false;
  }

  public getAidEditorsForScenario(shortId: string): vscode.Uri[] {
    const uris: vscode.Uri[] = [];
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== "aid") {
        continue;
      }
      const parts = doc.uri.path.split("/").filter(Boolean);
      if (parts[0] === "scenario" && parts.length >= 3 && parts[1] === shortId) {
        uris.push(doc.uri);
      }
    }
    return uris;
  }

  public async revertAllAidEditorsForScenario(shortId: string): Promise<void> {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== "aid") {
        continue;
      }
      const parts = doc.uri.path.split("/").filter(Boolean);
      if (parts[0] !== "scenario" || parts.length < 3 || parts[1] !== shortId) {
        continue;
      }
      try {
        await vscode.commands.executeCommand("workbench.action.files.revert", doc.uri);
      } catch {
        // ignore
      }
    }
  }

  public async closeAllAidEditorsForScenario(uris: vscode.Uri[]): Promise<void> {
    for (const uri of uris) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      } catch {
        // ignore
      }
    }
  }

  private openAidTabUris(): Set<string> {
    const set = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input: any = tab.input as any;
        if (input && input.uri instanceof vscode.Uri) {
          const u: vscode.Uri = input.uri;
          if (u.scheme === "aid") {
            set.add(u.toString());
          }
        }
      }
    }
    return set;
  }

  private parseAidUri(uri: vscode.Uri | { scheme: string; path: string }): { shortId: string; event: ScriptEvent } | null {
    if (uri.scheme !== "aid") {
      return null;
    }
    const path = (uri as any).path || "";
    const parts = path.split("/").filter(Boolean);
    if (parts[0] !== "scenario") {
      return null;
    }
    if (parts.length !== 3 && parts.length !== 4) {
      return null;
    }
    const shortId = parts[1];
    const event = (parts[2] || "").replace(/\.js$/i, "") as ScriptEvent;
    if (!["sharedLibrary", "onInput", "onOutput", "onModelContext"].includes(event)) {
      return null;
    }
    return { shortId, event };
  }
}
