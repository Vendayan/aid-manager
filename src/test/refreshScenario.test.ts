import * as assert from "assert";
import * as vscode from "vscode";
import { refreshScenario, RefreshScenarioContext } from "../refreshScenario";

const makeUri = (name: string) => vscode.Uri.from({ scheme: "aid", path: `/scenario/demo/${name}.js` });

suite("refreshScenario helper", () => {
  const baseDeps = (opts?: { shouldPurge?: boolean; dirtyScripts?: number; panelDirty?: boolean }) => {
    const events = {
      clearSnapshot: 0,
      requestServerReload: 0,
      revert: 0,
      closeEditors: 0
    };

    const panelMeta = { disposed: false };
    const panel = {
      viewColumn: vscode.ViewColumn.Two,
      dispose() { panelMeta.disposed = true; },
      reveal: () => { /* noop */ },
      webview: {} as vscode.Webview,
      title: "Scenario",
      onDidDispose: () => ({ dispose() { /* noop */ } })
    } as unknown as vscode.WebviewPanel;

    const scenarioPanels = new Map<string, { panel: vscode.WebviewPanel; dirty: boolean }>();
    scenarioPanels.set("demo", { panel, dirty: opts?.panelDirty ?? false });
    const reopenCalls: Array<{ shortId: string; column?: vscode.ViewColumn }> = [];
    const confirmMessages: string[] = [];

    const ctx: RefreshScenarioContext & {
      events: typeof events;
      panelEntry: { panel: vscode.WebviewPanel; dirty: boolean };
      reopenCalls: typeof reopenCalls;
      confirmMessages: string[];
      panelMeta: typeof panelMeta;
    } = {
      scenarioService: {
        shouldPurgeOnRefresh: async () => !!opts?.shouldPurge,
        requestServerReload: () => { events.requestServerReload += 1; }
      } as any,
      fsProvider: {
        clearSnapshot: () => { events.clearSnapshot += 1; }
      } as any,
      editorTracker: {
        getAidEditorsForScenario: () => [makeUri("sharedLibrary")],
        revertAllAidEditorsForScenario: async () => { events.revert += 1; },
        closeAllAidEditorsForScenario: async () => { events.closeEditors += 1; }
      } as any,
      openScenarioFormPanel: async (shortId: string, column?: vscode.ViewColumn) => {
        reopenCalls.push({ shortId, column });
      },
      scenarioPanels,
      countDirtyEditors: () => opts?.dirtyScripts ?? 0,
      events,
      panelEntry: scenarioPanels.get("demo")!,
      reopenCalls,
      confirmMessages,
      panelMeta
    };
    return ctx;
  };

  test("refresh without purge or dirty data skips confirmation", async () => {
    const deps = baseDeps();
    const result = await refreshScenario(deps, { shortId: "demo", label: "Demo" }, async (msg) => {
      deps.confirmMessages.push(msg);
      return true;
    });

    assert.strictEqual(result, true);
    assert.strictEqual(deps.confirmMessages.length, 0);
    assert.strictEqual(deps.events.clearSnapshot, 1);
    assert.strictEqual(deps.events.requestServerReload, 1);
    assert.strictEqual(deps.events.revert, 0);
    assert.strictEqual(deps.panelMeta.disposed, true);
    assert.deepStrictEqual(deps.reopenCalls, [{ shortId: "demo", column: vscode.ViewColumn.Two }]);
  });

  test("refresh cancels when dirty scripts are present and user rejects", async () => {
    const deps = baseDeps({ dirtyScripts: 2 });
    const result = await refreshScenario(deps, { shortId: "demo", label: "Demo" }, async () => false);

    assert.strictEqual(result, false);
    assert.strictEqual(deps.events.clearSnapshot, 0);
    assert.strictEqual(deps.panelMeta.disposed, false);
  });

  test("refresh with purge confirms and closes editors", async () => {
    const deps = baseDeps({ shouldPurge: true });
    const result = await refreshScenario(deps, { shortId: "demo", label: "Demo" }, async () => true);

    assert.strictEqual(result, true);
    assert.strictEqual(deps.events.clearSnapshot, 1);
    assert.strictEqual(deps.events.requestServerReload, 1);
    assert.strictEqual(deps.events.revert, 1);
    assert.strictEqual(deps.events.closeEditors, 1);
    assert.strictEqual(deps.panelMeta.disposed, true);
    assert.deepStrictEqual(deps.reopenCalls, [{ shortId: "demo", column: vscode.ViewColumn.Two }]);
  });

  test("refresh warns when scenario form is dirty", async () => {
    const deps = baseDeps({ panelDirty: true });
    let confirmed = false;
    const result = await refreshScenario(deps, { shortId: "demo", label: "Demo" }, async () => {
      confirmed = true;
      return true;
    });

    assert.strictEqual(result, true);
    assert.strictEqual(confirmed, true);
    assert.strictEqual(deps.events.revert, 0, "scripts should not be reverted when only panel is dirty");
    assert.strictEqual(deps.panelMeta.disposed, true);
  });
});
