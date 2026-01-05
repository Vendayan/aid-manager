import * as vscode from "vscode";
import { ScenarioService } from "./ScenarioService";
import { AidFsProvider } from "./AIDFSProvider";
import { EditorTracker } from "./EditorTracker";

export type RefreshScenarioContext = {
  scenarioService: ScenarioService;
  fsProvider: AidFsProvider;
  editorTracker: EditorTracker;
  scenarioPanels: Map<string, { panel: vscode.WebviewPanel; dirty: boolean }>;
  openScenarioFormPanel: (shortId: string, column?: vscode.ViewColumn) => Promise<void>;
  countDirtyEditors: (shortId: string) => number;
};

export type RefreshTarget = {
  shortId: string;
  label: string;
};

export type RefreshConfirmFn = (message: string) => Promise<boolean>;

/**
 * Core logic behind the refresh command so it can be unit tested.
 * Returns true when the refresh completed, or false if the user cancelled.
 */
export async function refreshScenario(
  ctx: RefreshScenarioContext,
  target: RefreshTarget,
  confirm: RefreshConfirmFn
): Promise<boolean> {
  const { shortId, label } = target;
  const {
    scenarioService,
    fsProvider,
    editorTracker,
    scenarioPanels,
    openScenarioFormPanel,
    countDirtyEditors
  } = ctx;

  const shouldPurge = await scenarioService.shouldPurgeOnRefresh(shortId);
  const existingPanelEntry = scenarioPanels.get(shortId);
  const existingPanel = existingPanelEntry?.panel;
  const panelDirty = existingPanelEntry?.dirty ?? false;
  const reopenColumn = existingPanel?.viewColumn ?? vscode.ViewColumn.Active;
  const dirtyScripts = countDirtyEditors(shortId);
  let closedPanel = false;
  const closePanel = () => {
    if (existingPanel && !closedPanel) {
      closedPanel = true;
      existingPanel.dispose();
    }
  };

  const reasons: string[] = [];
  if (shouldPurge) {
    reasons.push("the server has newer data");
  }
  if (dirtyScripts > 0) {
    reasons.push(`you have ${dirtyScripts} unsaved script${dirtyScripts === 1 ? "" : "s"}`);
  }
  if (panelDirty) {
    reasons.push("the scenario form has unsaved changes");
  }

  if (reasons.length > 0) {
    const first = reasons[0].charAt(0).toUpperCase() + reasons[0].slice(1);
    const rest = reasons.slice(1);
    const summary = rest.length ? [first, ...rest].join(" and ") : first;
    const message = `Refresh “${label}”? ${summary}. Continuing will close editors and discard local changes.`;
    const confirmed = await confirm(message);
    if (!confirmed) {
      return false;
    }
  }

  if (shouldPurge) {
    closePanel();
    fsProvider.clearSnapshot(shortId);
    scenarioService.requestServerReload(shortId);
  } else {
    closePanel();
    fsProvider.clearSnapshot(shortId);
    scenarioService.requestServerReload(shortId);
  }

  // Force-fetch story cards so the tree reflects server state right after refresh.
  await scenarioService.forceRefreshStoryCards(shortId);

  if (shouldPurge || dirtyScripts > 0) {
    const openUris = editorTracker.getAidEditorsForScenario(shortId);
    await editorTracker.revertAllAidEditorsForScenario(shortId);
    await editorTracker.closeAllAidEditorsForScenario(openUris);
  }

  if (closedPanel) {
    await openScenarioFormPanel(shortId, reopenColumn);
  }

  return true;
}
