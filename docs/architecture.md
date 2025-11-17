# Architecture

The extension is deliberately thin: it renders a `TreeDataProvider` for AI Dungeon scenarios, exposes the scripting fields under each scenario, and mediates read/write access to the AI Dungeon GraphQL API through a custom file system provider. Everything fans out from `activate` in `src/extension.ts`.

## High-Level Diagram
```
VS Code Commands + Views
        │
        ▼
ScenarioTreeProvider ──────► LocalStore (snapshots + overrides)
        │
        ├─► AidFsProvider (virtual files for scripts + scenario JSON)
        │       │
        │       ├─reads via AIDClient.getScenarioScripting / ScenarioService.getEditorJson
        │       └─writes via ScriptService.saveScriptsAtomic → AIDClient.updateScenarioScripts
        │
        └─► EditorTracker (keeps “missing script” badges accurate)

AIDClient ──► AuthService ──► Firebase token storage + refresh
```

## Modules

### `extension.ts`
- Instantiates `AuthService`, `AIDClient`, `ScenarioTreeProvider`, `AidFsProvider`, `ScenarioService`, `ScriptService`, and `EditorTracker`.
- Registers `aid:` file system, tree view (`aid-manager.scenarios`), and commands (sign-in/out, refresh, open/edit/export scenarios).
- Wires the scenario JSON reader for `aid:/scenario/{shortId}/…` URIs and the remote save callback for scripts.

### `ScenarioTreeProvider`
- Paginates through `AIDClient.listScenariosPage` to populate the root of the tree.
- For each scenario node, resolves whether it is a container (`getScenarioInfo` reports child options) or a leaf that exposes the four script fields. Containers can nest arbitrarily deep, so the provider simply recurses on children as long as the API supplies `options`.
- Depends on `LocalStore` to cache the last known server snapshot and to honor overrides that mark scripts as “missing” or “exists” while a user is editing.
- Exposes helpers so other services can invalidate caches (`requestServerReload`, `clearOverridesForScenario`, etc.).

### `AidFsProvider`
- Implements the `aid:` virtual scheme. Paths are shaped as `/scenario/{shortId}/{event}.js` or `/scenario/{shortId}/{Pretty}.json`.
- `readFile`:
  - Serves scenario JSON via the injected `ScenarioService.getEditorJson` reader.
  - Serves script text from an in-memory snapshot, fetching from `AIDClient.getScenarioScripting` when cold.
- `writeFile`:
  - Validates that the target is one of the four script events and forwards the buffer to `ScriptService.saveScriptsAtomic`.
  - Emits change events so VS Code refreshes open editors after server writes complete.

### `ScriptService`
- Centralizes multi-buffer saves:
  - Gathers every open `aid:` editor for the scenario (`collectOpenBuffers`).
  - Merges those buffers with freshly fetched server values to avoid overwriting scripts the user did not touch.
  - Calls `AIDClient.updateScenarioScripts` with the normalized payload (empty text => `null`).
- Serializes saves per scenario using `withScenarioLock` to avoid concurrent writes.
- Updates `AidFsProvider` snapshots, the `ScenarioTreeProvider` server cache, and `EditorTracker` once the mutation returns so the UI reflects new server state.

### `ScenarioService`
- Provides scenario metadata in two normalized forms:
  - `getEditorJson` – trimmed fields used by the webview scenario form.
  - `getExportJson` – richer payload used for `scenario.json` exports.
- Offers export helpers that fetch scripts + JSON for a leaf scenario or every child option inside a container scenario.
- Hosts the scenario form webview (HTML at `media/scenario`) and forwards scenario/story card CRUD actions back to `AIDClient`.

### Supporting Classes
- `AuthService` – stores Firebase ID + refresh tokens in VS Code secrets. The current UI only supports “paste token” auth because Google blocks password exchange from Node with the shipped API key. If a refresh token is present, it automatically refreshes via `securetoken.googleapis.com`.
- `EditorTracker` – tracks `aid:` editors that were opened when a script did not yet exist so the tree view shows them as “create” until the user saves or closes them. Once the server reports non-empty text for an event, the badge disappears.
- `LocalStore` – memoizes snapshots, script existence overrides, and “force reload” flags per scenario. It emits `onDidChange` events consumed by the tree provider and watchers.

## Key Data Flows
- **Activation** – `setContext(aid-manager.isAuthed)` toggles welcome content + sign-in button. `ScenarioTreeProvider` gates API calls behind `AIDClient.preflightAuth`.
- **Scenario Listing** – uses `searchNoCache` with filters (`username`, `isCurrentUser: true`) to fetch up to 500 scenarios at a time. A “Load more…” row paginates via offset.
- **Scenario Expansion** – `getScenarioInfo` distinguishes containers vs leaves. Containers show child options with their own `ScenarioItem`s. Leaves fan out into four `ScriptRow`s.
- **Script Editing** – opening a script resolves to an `aid:` URI backed by the FS provider; writes reinvoke `ScriptService.saveScriptsAtomic`. The tree rows toggle between `"script"` and `"script.missing"` contexts based on text presence + overrides.
- **Scenario JSON** – `aid-manager.openScenarioJson` opens a read-only `aid:` document. Users must “Save As” to persist locally; remote writes are intentionally disabled.
- **Scenario Export** – `ScenarioService.exportScenarioScripts` prompts for a destination folder and writes four `.js` files plus a normalized `scenario.json`. Container scenarios create subfolders per child option. Export is intentionally one-way; there is no import pipeline yet.

See [[ai-dungeon-api]] for the concrete GraphQL queries/mutations behind these flows.
