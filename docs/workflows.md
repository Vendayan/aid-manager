# Workflows

## Authentication
1. User opens the **Scenarios** view. The welcome content renders if `aid-manager.isAuthed` is false.
2. Running `aid-manager.signIn` prompts for a Firebase ID token; the token is stored via `vscode.secrets`.
3. `ScenarioTreeProvider.getChildren` calls `AIDClient.preflightAuth()` before any GraphQL request. If the state is not `valid`, it returns an empty list so the welcome view stays visible.

## Scenario Discovery & Navigation
1. Root expansion triggers `ScenarioTreeProvider.loadMoreRoot()` which calls `AIDClient.listScenariosPage` using the username configured in settings.
2. Each scenario row is represented by `ScenarioItem`. Selecting/expanding a node:
   - Calls `AIDClient.getScenarioInfo` to determine whether the node is a container or a leaf.
   - Updates the node’s `contextValue` to `scenario.container` or `scenario.leaf` so context menu commands (refresh, export, open JSON/form) show correctly.
3. Container nodes render child `ScenarioItem`s that can be expanded again (repeat as deep as the API will go). Leaf nodes show four `ScriptRow`s (`Shared Library`, `Input`, `Output`, `Context`). If the API returns an empty string for a script event, the row shows a `create` hint to indicate it does not yet exist server-side.

## Opening Scripts
1. Invoking `aid-manager.openScript` (via click or context command) resolves event metadata from the tree row.
2. `ScriptService.openScript`:
   - Generates an `aid:/scenario/{shortId}/{event}/{Pretty}.js` URI and opens it in VS Code.
   - If the script does not yet exist, marks it as “exists” in the tree and records the document in `EditorTracker` so it stays “create” until a save happens.
3. The editor’s read calls hit `AidFsProvider.readFile`, which fetches the latest snapshot from `AIDClient.getScenarioScripting`.

## Saving Scripts
1. Saves are initiated by VS Code when the user triggers `⌘S` on an `aid:` buffer. `AidFsProvider.writeFile` receives the text and forwards it to `ScriptService.saveScriptsAtomic`.
2. `saveScriptsAtomic`:
   - Guards against multiple dirty buffers by prompting “Save All” when several script documents for the same scenario are dirty.
   - Locks per scenario to serialize concurrent saves.
   - Collects text from all open script editors and merges it with fresh server data so untouched scripts are preserved.
   - Calls `AIDClient.updateScenarioScripts`.
   - Writes the server response back to the `AidFsProvider` snapshot and `ScenarioTreeProvider` cache so subsequent reads stay in sync.
   - Reverts every open `aid:` editor for the scenario so there are no stale dirty buffers.

## Refreshing Scenarios
1. `aid-manager.refreshScenario` calls `ScenarioService.shouldPurgeOnRefresh` which hashes the latest server scripts and compares `editedAt` timestamps.
2. If the server data changed since the last refresh, the user is warned that open editors will be closed. Confirming:
   - Calls `EditorTracker.revertAllAidEditorsForScenario` and `closeAllAidEditorsForScenario`.
   - Disposes any open scenario form webviews for that shortId and re-opens them once fresh data is fetched.
   - Clears overrides + cached snapshots for the scenario so the next expansion re-fetches fresh data.

## Scenario JSON & Form
- **Open Scenario JSON** (`aid-manager.openScenarioJson`):
  - Opens `aid:/scenario/{shortId}/{name}.json` via the FS provider. Edits are stored locally until GraphQL mutations exist.
  - Cannot coexist with the scenario form for the same shortId. When switching surfaces, the extension prompts to Save/Discard (or cancel) and applies changes locally before reopening the other view.
- **Scenario Form Webview** (`aid-manager.openScenarioForm`):
  - Renders the React bundle under `media/scenario/dist` (source in `webview-ui/`).
  - Receives the normalized scenario model (`ScenarioService.getEditorJson`), story cards, and optional plot components.
  - Tracks dirty state and responds to host requests for the current snapshot so refresh flows can warn before closing tabs.
  - Clicking **Save Changes** posts the snapshot back to the host, which calls `ScenarioService.saveScenarioSnapshot` to run the GraphQL `updateScenario` mutation and then re-fetch the scenario so the UI reflects the latest server truth.
  - Use `npm run build:webview` to regenerate assets after UI changes; the build runs automatically before packaging via `npm run vscode:prepublish`.

## Exporting
1. `aid-manager.exportScenarioScripts` prompts for a destination folder.
2. Leaf scenarios:
   - Writes four `.js` files and a normalized `scenario.json`.
3. Container scenarios:
   - Enumerate child options.
   - For each child, create `Child Title (shortId)/` with the four scripts plus `scenario.json`.
4. Overwrites are confirmed per file/folder when conflicts arise.

## File System Provider Edge Cases
- Writes to scenario JSON are intentionally blocked; a warning toast suggests using “Save As”.
- Delete/rename is disabled for all `aid:` resources to avoid severing references to server-backed scripts.

Refer back to [[architecture]] for the services that implement these flows and [[ai-dungeon-api]] for the backing GraphQL calls.
