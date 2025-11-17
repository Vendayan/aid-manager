# AI Dungeon API Integration

## Endpoints & Auth
- GraphQL endpoint: configurable via `aid-manager.AIDEndpoint` (defaults to `https://api.aidungeon.com/graphql`).
- Requests include:
  - `content-type: application/json`
  - `accept`, `cache-control`, `pragma`, and `accept-language` headers.
  - Custom auth header determined by settings:
    - `aid-manager.authHeaderName` (default `Authorization`).
    - `aid-manager.authHeaderFormat` (default `firebase ${token}`).
  - Optional `x-gql-operation-name` when `operationName` is provided.
- Tokens come from `AuthService.ensureValidToken()`:
  - Primary path is “paste Firebase ID token”.
  - If a refresh token exists, `refreshIdToken` hits `https://securetoken.googleapis.com/v1/token`.
  - Missing/expired tokens bubble up as `AUTH_MISSING` or `AUTH_EXPIRED`, which the UI interprets to show the sign-in welcome view.

## GraphQL Operations

### Scenario Discovery
- `GetSearchDataNoCache` (`listScenariosPage`)
  - Inputs: `SearchInput` with `contentType: "scenario"`, username filters, pagination (`limit`, `offset`).
  - Returns: `id`, `shortId`, `title`, `contentType`.
  - `hasMore` computed locally (`items.length === limit`).
- `GetScenario` (`getScenarioInfo`)
  - Fetches `scenario(shortId)` and its `options` list to determine whether the scenario is a container.
  - Children exclude headers (where `option.shortId === root.shortId`) and unparented nodes.

### Scenario Content
- `GetScenario` (`getScenarioFull`)
  - Rich payload used for JSON view/export (`title`, `prompt`, `memory`, `authorsNote`, tags, parent info, child options, story cards, publishing fields, etc.).
- `GetScenarioScripting`
  - Fetches the four script fields: `gameCodeSharedLibrary`, `gameCodeOnInput`, `gameCodeOnOutput`, `gameCodeOnModelContext`.
  - `ScriptService`, `AidFsProvider`, and `ScenarioTreeProvider` all depend on this call for snapshots.
- `GetScenarioDetails` *(optional)* – not defined in `AIDClient` yet, but `ScenarioService` probes for `getScenarioDetails` to populate plot components when available.

### Script Updates
- `UpdateScenarioScripts`
  - Mutation signature: `updateScenarioScripts(shortId: String, gameCode: JSONObject)`.
  - Payload example:
    ```json
    {
      "shortId": "abcdef",
      "gameCode": {
        "sharedLibrary": "// shared helpers",
        "onInput": "return state;",
        "onOutput": null,
        "onModelContext": null
      }
    }
    ```
  - On success returns `{ success, message, scenario { gameCode* } }`.
  - `ScriptService.saveScriptsAtomic` normalizes empty strings to `null`, merges other open buffers to preserve concurrent edits, and updates UI caches when the mutation resolves.

### Scenario JSON Export
- No dedicated mutation: `ScenarioService.exportScenarioScripts` merely calls:
  - `getScenarioScripting` for script files.
  - `getScenarioFull` followed by `normalizeExportJson` for `scenario.json`.
  - When exporting containers, iterates over child options returned inside `options`.

### Story Cards
- `ScenarioService` calls the GraphQL mutations through `AIDClient.createStoryCard`, `.updateStoryCard`, and `.deleteStoryCard`. These use the existing API inputs (`CreateStoryCardInput`, `UpdateStoryCardInput`, etc.) and refresh the scenario JSON after each mutation so the webview reflects the server truth.
- Story card search/filtering lives entirely inside the webview; no separate API call is required until a card is created, updated, or deleted.

## Error Handling
- HTTP 401/403 are treated as `AUTH_EXPIRED`.
- GraphQL errors (non-empty `errors` array) are aggregated into a single `GraphQL Error: …` message.
- Missing `data` field triggers `GraphQL response had no data`.
- Scenario refresh flow compares `editedAt` plus a hash of the four script fields. When either changes, `ScenarioService.shouldPurgeOnRefresh` forces editor tabs to revert/re-open to avoid editing stale cached scripts.

See [[workflows]] for how these API calls show up inside VS Code.
