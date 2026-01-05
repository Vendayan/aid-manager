import * as vscode from "vscode";
import { AIDClient } from "./AIDClient";
import { AidFsProvider } from "./AIDFSProvider";
import { FIELD_BY_EVENT, ScriptEvent } from "./AIDTypes";
import { EditorTracker } from "./EditorTracker";
import { ScenarioService } from "./ScenarioService";

function sanitizePretty(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "_").trim();
}

function normalizeForServer(text: string | null | undefined): string | null {
  const v = (text ?? "").toString();
  if (v.trim().length === 0) {
    return null;
  }
  return v;
}

export class ScriptService {
  private saveLocks = new Map<string, Promise<void>>();

  public constructor(
    private client: AIDClient,
    private fsProvider: AidFsProvider,
    private editors: EditorTracker,
    private scenarios: ScenarioService
  ) {}

  public async openScript(args: {
    shortId: string;
    event: ScriptEvent;
    scenarioName: string;
    scriptName: string;
    existed: boolean;
  }): Promise<void> {
    const { shortId, event, scenarioName, scriptName, existed } = args;

    if (!existed) {
      this.scenarios.markScriptExists(shortId, event);
    }

    const pretty = sanitizePretty(`${scenarioName} - ${scriptName}.js`);
    const uri = vscode.Uri.from({
      scheme: "aid",
      path: `/scenario/${shortId}/${event}/${pretty}`
    });

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(doc, "javascript");
    await vscode.window.showTextDocument(doc, { preview: false });

    if (!existed) {
      this.editors.trackOpenedWhileMissing(doc.uri, shortId, event);
    }
  }

  public async saveScriptsAtomic(args: { scenarioShortId: string; event: ScriptEvent; content: string }): Promise<void> {
    const { scenarioShortId, event, content } = args;

    const okToSave = await this.maybeConfirmMultiSaveDirtyOnly(scenarioShortId);
    if (!okToSave) {
      throw new Error("Save cancelled.");
    }

    await this.withScenarioLock(scenarioShortId, async () => {
      const openBuffers = await this.collectOpenBuffers(scenarioShortId);
      const fetched = await this.client.getScenarioScripting(scenarioShortId);

      const merged = {
        sharedLibrary: openBuffers.sharedLibrary ?? fetched.gameCodeSharedLibrary ?? null,
        onInput: openBuffers.onInput ?? fetched.gameCodeOnInput ?? null,
        onOutput: openBuffers.onOutput ?? fetched.gameCodeOnOutput ?? null,
        onModelContext: openBuffers.onModelContext ?? fetched.gameCodeOnModelContext ?? null
      };

      const mapKey = {
        sharedLibrary: "sharedLibrary",
        onInput: "onInput",
        onOutput: "onOutput",
        onModelContext: "onModelContext"
      } as const;
      const keyForEvent = mapKey[event as keyof typeof mapKey];
      (merged as any)[keyForEvent] = content;

      const payload = {
        sharedLibrary: normalizeForServer(merged.sharedLibrary),
        onInput: normalizeForServer(merged.onInput),
        onOutput: normalizeForServer(merged.onOutput),
        onModelContext: normalizeForServer(merged.onModelContext)
      };

      const result = await this.client.updateScenarioScripts(scenarioShortId, payload);
      vscode.window.setStatusBarMessage(`Saved scripts for scenario ${scenarioShortId}`, 2000);

      if (result.scenario) {
        this.fsProvider.applyServerSnapshot(scenarioShortId, {
          sharedLibrary: result.scenario.gameCodeSharedLibrary ?? null,
          onInput: result.scenario.gameCodeOnInput ?? null,
          onOutput: result.scenario.gameCodeOnOutput ?? null,
          onModelContext: result.scenario.gameCodeOnModelContext ?? null
        });

        this.scenarios.setServerScriptSnapshot(scenarioShortId, {
          sharedLibrary: result.scenario.gameCodeSharedLibrary ?? null,
          onInput: result.scenario.gameCodeOnInput ?? null,
          onOutput: result.scenario.gameCodeOnOutput ?? null,
          onModelContext: result.scenario.gameCodeOnModelContext ?? null
        });

        const pairs: Array<[ScriptEvent, string | null | undefined]> = [
          ["sharedLibrary", result.scenario.gameCodeSharedLibrary],
          ["onInput", result.scenario.gameCodeOnInput],
          ["onOutput", result.scenario.gameCodeOnOutput],
          ["onModelContext", result.scenario.gameCodeOnModelContext]
        ];

        for (const [ev, val] of pairs) {
          const serverHasText = typeof val === "string" && val.trim().length > 0;
          const editorOpen = this.editors.isAidEditorOpenFor(scenarioShortId, ev);

          if (serverHasText || editorOpen) {
            this.scenarios.markScriptExists(scenarioShortId, ev);
            if (serverHasText) {
              this.editors.clearMissingFlagForOpenTabs(scenarioShortId, ev);
            }
          } else {
            this.scenarios.markScriptMissing(scenarioShortId, ev);
          }
        }
      }

      await this.editors.revertAllAidEditorsForScenario(scenarioShortId);
    });
  }

  private async maybeConfirmMultiSaveDirtyOnly(shortId: string): Promise<boolean> {
    let dirtyCount = 0;
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== "aid") {
        continue;
      }
      if (!doc.isDirty) {
        continue;
      }
      const parts = doc.uri.path.split("/").filter(Boolean);
      if (parts[0] !== "scenario" || parts.length < 3) {
        continue;
      }
      if (parts[1] !== shortId) {
        continue;
      }
      const event = (parts[2] || "").replace(/\.js$/i, "");
      if (event === "scenario.json") {
        continue; // scenario json is not part of atomic script save
      }
      dirtyCount++;
    }

    if (dirtyCount <= 1) {
      return true;
    }

    const choice = await vscode.window.showWarningMessage(
      `You have ${dirtyCount} changed scripts for this scenario open. Saving will update all four scripts on the server. Continue?`,
      { modal: true },
      "Save All",
      "Cancel"
    );
    return choice === "Save All";
  }

  private withScenarioLock(shortId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.saveLocks.get(shortId) ?? Promise.resolve();
    const next = prev.catch(() => { /* swallow */ }).then(task);
    this.saveLocks.set(
      shortId,
      next.finally(() => {
        if (this.saveLocks.get(shortId) === next) {
          this.saveLocks.delete(shortId);
        }
      })
    );
    return next;
  }

  private async collectOpenBuffers(shortId: string): Promise<{
    sharedLibrary?: string;
    onInput?: string;
    onOutput?: string;
    onModelContext?: string;
  }> {
    const out: any = {};
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== "aid") {
        continue;
      }
      const parts = doc.uri.path.split("/").filter(Boolean);
      if (parts[0] !== "scenario" || parts.length < 3) {
        continue;
      }
      if (parts[1] !== shortId) {
        continue;
      }
      const event = (parts[2] || "").replace(/\.js$/i, "");
      if (event === "sharedLibrary") {
        out.sharedLibrary = doc.getText();
      }
      if (event === "onInput") {
        out.onInput = doc.getText();
      }
      if (event === "onOutput") {
        out.onOutput = doc.getText();
      }
      if (event === "onModelContext") {
        out.onModelContext = doc.getText();
      }
    }
    return out;
  }
}
