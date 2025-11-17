import * as vscode from 'vscode';
import { AuthService } from './AuthService';
import { ScenarioTreeProvider } from './ScenarioTree';
import { AIDClient } from './AIDClient';
import { AidFsProvider } from './AIDFSProvider';
import { FIELD_BY_EVENT, ScriptEvent } from './AIDTypes';
import { ScriptService } from './ScriptService';
import { ScenarioService } from './ScenarioService';
import { EditorTracker } from './EditorTracker';
import { SharedLibraryIntellisense } from './SharedLibraryIntellisense';
import { refreshScenario } from './refreshScenario';

type ScenarioPanelEntry = { panel: vscode.WebviewPanel; baseTitle: string; dirty: boolean };
const DIRTY_SUFFIX = " ●";

function applyScenarioPanelTitle(entry: ScenarioPanelEntry): void {
  entry.panel.title = entry.baseTitle + (entry.dirty ? DIRTY_SUFFIX : "");
}

async function setAuthed(flag: boolean) {
  await vscode.commands.executeCommand('setContext', 'aid-manager.isAuthed', flag);
}

function sanitizePretty(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "_").trim();
}

export async function activate(context: vscode.ExtensionContext) {
  const auth = new AuthService(context);
  const client = new AIDClient(context, auth);
  const tree = new ScenarioTreeProvider(client);
  // Track scenario form webviews so refresh can close/reopen them with fresh data.
  const scenarioPanels = new Map<string, ScenarioPanelEntry>();

  context.subscriptions.push(vscode.window.registerTreeDataProvider('aid-manager.scenarios', tree));

  // Derive the initial auth context from our secret store so view/title actions render correctly.
  const initialAuthState = await auth.authState().catch(() => "missing");
  await setAuthed(initialAuthState === "valid");

  const editorTracker = new EditorTracker(tree);
  editorTracker.attach(context);

  const fsProvider = new AidFsProvider(
    client,
    async () => { /* set below */ },
    async (_shortId: string) => Buffer.from("{}", "utf8")
  );
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('aid', fsProvider, { isCaseSensitive: true }));

  const scenarioService = new ScenarioService(client);
  fsProvider.setScenarioJsonReader(async (shortId: string) => {
    const model = await scenarioService.getEditorJson(shortId);
    const json = JSON.stringify(model, null, 2);
    return Buffer.from(json, "utf8");
  });
  fsProvider.setScenarioJsonWriter(async (shortId: string, content: Uint8Array) => {
    const text = new TextDecoder().decode(content);
    await scenarioService.applyScenarioJsonText(shortId, text);
  });
  const setScenarioPanelDirty = (shortId: string, dirty: boolean) => {
    const entry = scenarioPanels.get(shortId);
    if (!entry) {
      return;
    }
    if (entry.dirty === dirty) {
      return;
    }
    entry.dirty = dirty;
    applyScenarioPanelTitle(entry);
  };
  const removeScenarioPanelEntry = (shortId: string, panel: vscode.WebviewPanel) => {
    const entry = scenarioPanels.get(shortId);
    if (entry?.panel === panel) {
      scenarioPanels.delete(shortId);
    }
  };
  const countDirtyEditors = (shortId: string): number => {
    let dirty = 0;
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== "aid" || !doc.isDirty) {
        continue;
      }
      const parts = doc.uri.path.split("/").filter(Boolean);
      if (parts[0] !== "scenario" || parts.length < 2) {
        continue;
      }
      if (parts[1] !== shortId) {
        continue;
      }
      dirty++;
    }
    return dirty;
  };
  const parseAidUri = (uri: vscode.Uri): { shortId: string; resource: string } | null => {
    if (uri.scheme !== "aid") {
      return null;
    }
    const parts = uri.path.split("/").filter(Boolean);
    if (parts[0] !== "scenario" || parts.length < 3) {
      return null;
    }
    return { shortId: parts[1], resource: parts[2] };
  };
  const findScenarioJsonDocument = (shortId: string): vscode.TextDocument | undefined => {
    return vscode.workspace.textDocuments.find((doc) => {
      const parsed = parseAidUri(doc.uri);
      if (!parsed) {
        return false;
      }
      return parsed.shortId === shortId && parsed.resource.toLowerCase().endsWith(".json");
    });
  };
  const ensureScenarioJsonClosed = async (shortId: string, label: string): Promise<boolean> => {
    const doc = findScenarioJsonDocument(shortId);
    if (!doc) {
      return true;
    }
    if (doc.isDirty) {
      const choice = await vscode.window.showWarningMessage(
        `Scenario JSON for “${label}” has unsaved changes. Save before continuing?`,
        { modal: true },
        "Save",
        "Discard",
        "Cancel"
      );
      if (!choice || choice === "Cancel") {
        return false;
      }
      if (choice === "Save") {
        try {
          const saved = await doc.save();
          if (!saved) {
            vscode.window.showErrorMessage("Failed to save scenario JSON.");
            return false;
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to save scenario JSON: ${err?.message ?? err}`);
          return false;
        }
      }
      if (choice === "Discard") {
        await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
        await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
        return true;
      }
    }
    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    return true;
  };
  const ensureScenarioPanelClosed = async (shortId: string, label: string): Promise<boolean> => {
    const entry = scenarioPanels.get(shortId);
    if (!entry) {
      return true;
    }
    if (entry.dirty) {
      const choice = await vscode.window.showWarningMessage(
        `Scenario editor for “${label}” has unsaved changes. Save before continuing?`,
        { modal: true },
        "Save",
        "Discard",
        "Cancel"
      );
      if (!choice || choice === "Cancel") {
        return false;
      }
      if (choice === "Save") {
        try {
          const snapshot = await scenarioService.requestScenarioState(entry.panel.webview);
          await scenarioService.saveScenarioSnapshot(shortId, snapshot);
          entry.dirty = false;
          applyScenarioPanelTitle(entry);
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to save scenario: ${err?.message ?? err}`);
          return false;
        }
      }
      if (choice === "Discard") {
        entry.dirty = false;
        applyScenarioPanelTitle(entry);
      }
    }
    entry.panel.dispose();
    return true;
  };
  const openScenarioFormPanel = async (shortId: string, column?: vscode.ViewColumn): Promise<void> => {
    const existing = scenarioPanels.get(shortId);
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Active, true);
      await scenarioService.sendScenarioInit(existing.panel.webview, shortId);
      return;
    }

    const model = await scenarioService.getEditorJson(shortId);
    const title = `Scenario: ${model?.title ?? shortId}`;

    const panel = vscode.window.createWebviewPanel("aidScenarioForm", title, column ?? vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
    });
    const entry: ScenarioPanelEntry = { panel, baseTitle: title, dirty: false };
    scenarioPanels.set(shortId, entry);
    applyScenarioPanelTitle(entry);
    panel.webview.html = await scenarioService.renderEditorUI(context, panel.webview);
    const subscription = scenarioService.attachWebviewHandlers(panel.webview, shortId, {
      onDirtyChange: (dirty) => setScenarioPanelDirty(shortId, dirty)
    });
    panel.onDidDispose(() => {
      subscription.dispose();
      removeScenarioPanelEntry(shortId, panel);
    });
    await scenarioService.sendScenarioInit(panel.webview, shortId);
  };

  const scriptService = new ScriptService(client, fsProvider, tree, editorTracker);
  fsProvider.setRemoteSave(async (args) => {
    await scriptService.saveScriptsAtomic(args);
  });

  await registerSharedLibraryIntellisense(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('aid-manager.refresh', () => {
      tree.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aid-manager.signIn', async () => {
      const ok = await auth.signInFlow();
      await setAuthed(!!ok);
      tree.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aid-manager.signOut', async () => {
      if (typeof auth.signOut === 'function') {
        await auth.signOut();
      }
      await setAuthed(false);
      tree.refresh();
      vscode.window.showInformationMessage('Signed out.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aid-manager.refreshScenario", async (item?: vscode.TreeItem) => {
      const scenario = (item as any)?.data as { shortId: string; title?: string; name?: string } | undefined;
      if (!scenario?.shortId) {
        return;
      }
      const label = scenario.title || scenario.name || scenario.shortId;
      await refreshScenario(
        {
          scenarioService,
          fsProvider,
          tree,
          editorTracker,
          scenarioPanels,
          openScenarioFormPanel,
          countDirtyEditors
        },
        { shortId: scenario.shortId, label },
        async (message) => {
          const choice = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            "Refresh Scenario",
            "Cancel"
          );
          return choice === "Refresh Scenario";
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aid-manager.openScript", async (item?: vscode.TreeItem) => {
      const d = (item as any)?.data;
      const shortId: string | undefined = d?.scenarioShortId;
      const event: ScriptEvent | undefined = d?.event;
      const fieldId: string | undefined = d?.fieldId;
      const scenarioName: string = d?.scenarioName ?? d?.title ?? "Scenario";
      const scriptName: string = d?.name ?? "Script";

      let resolvedEvent: ScriptEvent | undefined = event;
      if (!resolvedEvent && fieldId) {
        const found = (Object.entries(FIELD_BY_EVENT) as [ScriptEvent, string][]).find(([, v]) => v === fieldId);
        if (found) {
          resolvedEvent = found[0];
        }
      }

      if (!shortId || !resolvedEvent) {
        vscode.window.showWarningMessage("Cannot open script: missing scenario/event info.");
        return;
      }

      const existed = !!d?.exists;
      await scriptService.openScript({
        shortId,
        event: resolvedEvent,
        scenarioName,
        scriptName,
        existed
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aid-manager.saveCurrentAs", async () => {
      await vscode.commands.executeCommand("workbench.action.files.saveAs");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aid-manager.saveScriptLocal", async (item?: vscode.TreeItem) => {
      await vscode.commands.executeCommand("aid-manager.openScript", item);
      await vscode.commands.executeCommand("workbench.action.files.saveAs");
    })
  );

  // Scenario JSON (remote, read-only): flattened path => aid:/scenario/{shortId}/{Pretty}.json
  context.subscriptions.push(
    vscode.commands.registerCommand("aid-manager.openScenarioJson", async (item?: vscode.TreeItem) => {
      const scenario = (item as any)?.data as { shortId: string; title?: string; name?: string } | undefined;
      if (!scenario?.shortId) {
        return;
      }
      const label = scenario.title || scenario.name || scenario.shortId;
      const panelOk = await ensureScenarioPanelClosed(scenario.shortId, label);
      if (!panelOk) {
        return;
      }
      const pretty = sanitizePretty(`${scenario.title || scenario.name || scenario.shortId} - scenario.json`);
      const uri = vscode.Uri.from({ scheme: "aid", path: `/scenario/${scenario.shortId}/${pretty}` });
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(doc, "json");
      await vscode.window.showTextDocument(doc, { preview: false });
      vscode.window.setStatusBarMessage("Scenario JSON edits are saved locally until server sync is available.", 3000);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aid-manager.openScenarioForm", async (item?: vscode.TreeItem) => {
      const scenario = (item as any)?.data as { shortId: string; title?: string; name?: string } | undefined;
      if (!scenario?.shortId) {
        return;
      }
      const label = scenario.title || scenario.name || scenario.shortId;
      const jsonOk = await ensureScenarioJsonClosed(scenario.shortId, label);
      if (!jsonOk) {
        return;
      }
      await openScenarioFormPanel(scenario.shortId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aid-manager.exportScenarioScripts", async (item?: vscode.TreeItem) => {
      const scenario = (item as any)?.data as { shortId: string; title?: string; name?: string } | undefined;
      if (!scenario?.shortId) {
        return;
      }
      await scenarioService.exportScenario(scenario.shortId, scenario.title || scenario.name || scenario.shortId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aid-manager.loadMoreScenarios", async () => {
      await tree.loadMoreRoot();
    })
  );
}

async function registerSharedLibraryIntellisense(context: vscode.ExtensionContext): Promise<void> {
  try {
    const sharedPath = vscode.Uri.joinPath(context.extensionUri, "SharedLibraryTypes.d.ts");
    const scriptingPath = vscode.Uri.joinPath(context.extensionUri, "ScriptingTypes.d.ts");
    const sharedBytes = await vscode.workspace.fs.readFile(sharedPath);
    const scriptingBytes = await vscode.workspace.fs.readFile(scriptingPath);
    const sharedSource = Buffer.from(sharedBytes).toString("utf8");
    const scriptingSource = Buffer.from(scriptingBytes).toString("utf8");
    const selector: vscode.DocumentFilter = { scheme: "aid", language: "javascript" };

    class DynamicIntellisenseProvider implements vscode.CompletionItemProvider, vscode.HoverProvider {
      provideCompletionItems = (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, ctx: vscode.CompletionContext) => {
        return this.selectProvider(document).provideCompletionItems(document, position, token, ctx);
      };
      provideHover = (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) => {
        return this.selectProvider(document).provideHover(document, position, token);
      };
      private selectProvider(document: vscode.TextDocument): SharedLibraryIntellisense {
        const path = document.uri.path || "";
        const isShared = /\/sharedLibrary\//.test(path) || path.endsWith("/sharedLibrary.js");
        return new SharedLibraryIntellisense(sharedSource, scriptingSource, !isShared);
      }
    }

    const dynamicProvider = new DynamicIntellisenseProvider();
    const registerCompletionProvider = vscode.languages.registerCompletionItemProvider as any;
    context.subscriptions.push(
      registerCompletionProvider(selector, dynamicProvider)
    );
    context.subscriptions.push(vscode.languages.registerHoverProvider(selector, dynamicProvider as vscode.HoverProvider));
  } catch (err) {
    console.error("Failed to initialize Shared Library IntelliSense", err);
  }
}

export function deactivate() { }
