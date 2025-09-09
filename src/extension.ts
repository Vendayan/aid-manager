import * as vscode from 'vscode';
import { AuthService } from './AuthService';
import { ScenarioTreeProvider } from './ScenarioTree';
import { AIDClient } from './AIDClient';
import { AidFsProvider } from './AIDFSProvider';
import { FIELD_BY_EVENT, ScriptEvent } from './AIDTypes';
import { ScriptService } from './ScriptService';
import { ScenarioService } from './ScenarioService';
import { EditorTracker } from './EditorTracker';

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

  context.subscriptions.push(vscode.window.registerTreeDataProvider('aid-manager.scenarios', tree));

  const existingToken =
    (typeof (auth as any).getValidToken === 'function'
      ? await (auth as any).getValidToken()
      : await context.secrets.get('AIDCredential:credential')) || undefined;
  await setAuthed(!!existingToken);

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

  const scriptService = new ScriptService(client, fsProvider, tree, editorTracker);
  fsProvider.setRemoteSave(async (args) => {
    await scriptService.saveScriptsAtomic(args);
  });

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

      const shouldPurge = await scenarioService.shouldPurgeOnRefresh(scenario.shortId);
      if (shouldPurge) {
        const openUris = editorTracker.getAidEditorsForScenario(scenario.shortId);
        const label = scenario.title || scenario.name || scenario.shortId;

        const choice = await vscode.window.showWarningMessage(
          `Refresh “${label}”? Any open scripts for this scenario will be closed and unsaved changes will be discarded.`,
          { modal: true },
          "Refresh Scenario",
          "Cancel"
        );
        if (choice !== "Refresh Scenario") {
          return;
        }

        await editorTracker.revertAllAidEditorsForScenario(scenario.shortId);
        await editorTracker.closeAllAidEditorsForScenario(openUris);

        tree.clearOverridesForScenario(scenario.shortId);
        tree.requestServerReload(scenario.shortId);
      } else {
        tree.requestServerReload(scenario.shortId);
      }
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
      const pretty = sanitizePretty(`${scenario.title || scenario.name || scenario.shortId} - scenario.json`);
      const uri = vscode.Uri.from({ scheme: "aid", path: `/scenario/${scenario.shortId}/${pretty}` });
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.languages.setTextDocumentLanguage(doc, "json");
      await vscode.window.showTextDocument(doc, { preview: false });
      vscode.window.setStatusBarMessage("Scenario JSON is read-only remotely. Use Save As to export locally.", 3000);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aid-manager.openScenarioForm", async (item?: vscode.TreeItem) => {
      const scenario = (item as any)?.data as { shortId: string; title?: string; name?: string } | undefined;
      if (!scenario?.shortId) {
        return;
      }
      const model = await scenarioService.getEditorJson(scenario.shortId);
      const title = `Scenario: ${model?.title ?? scenario.shortId}`;

      const panel = vscode.window.createWebviewPanel("aidScenarioForm", title, vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
      });
      panel.webview.html = await scenarioService.renderEditorUI(context, panel.webview);
      panel.webview.postMessage({ type: "scenario:init", model });
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

export function deactivate() { }
