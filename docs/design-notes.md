# Design Notes

These notes capture the ongoing product direction gathered from discussions so we can keep the docs aligned with what we are trying to build.

## Scenario Tree & Containers
- AI Dungeon "multiple choice" (MC) scenarios are essentially containers. We expect them to be arbitrarily deep, so the tree view should support unlimited nesting as long as the API returns descendants. The current recursion logic already handles this.
- Leaf scenarios expose the four scripts (`Shared Library`, `Input`, `Output`, `Context`). When the API reports an empty string for a given event, the UI shows a `create` indicator. Opening that script should mark the row as "exists" once text is saved back to the server.

## Scenario Detail Surface
- The tree intentionally stays simple. Instead of stuffing story cards, notes, or metadata into the tree, selecting a scenario should open the richer webview editor that now supports full CRUD.
- That form should manage:
  - Scenario basics (title, prompt, memory, author’s note, tags, etc.).
  - Story card creation/edit/delete and any other "notes" fields that exist server-side.
  - Optional plot component editing once we confirm the API still exposes those hooks.
- Story card and scenario field mutations are already wired up through `ScenarioService` and `AIDClient`. See [[ai-dungeon-api]] for the exact GraphQL calls.

## Script Authoring Experience
- We now ship `SharedLibraryTypes.d.ts` and `ScriptingTypes.d.ts`, and `SharedLibraryIntellisense` wires them into every `aid:` editor so completions/hover info reflect the sandbox globals. Shared Library files only include the shared definitions, while the three event scripts also get the broader scripting API definitions.
- No preview/test harness exists today. Scripts save raw JavaScript and rely on AI Dungeon to execute them. Any validation would need to happen locally (linting) or by invoking the actual runtime, which is out of scope for now.

## Export Strategy
- Current export flow (four `.js` files + `scenario.json`) is acceptable in the near term and is intentionally one-way. There is no import flow yet, which avoids accidentally clobbering live scenarios.
- Container exports iterate child options and create subfolders per option; we may later revisit packaging (zip, VS Code tasks, etc.) once we decide on a sharing workflow.

## Authentication & Environments
- Users target different AI Dungeon environments by changing `aid-manager.AIDEndpoint` in settings. No multi-profile UI planned yet.
- Refresh tokens are blocked today because Firebase enforces HTTP referrer restrictions from the shipped API key. Until we obtain a key suitable for extensions, "paste token" remains the supported flow.

## Telemetry & Observability
- No telemetry or analytics are planned for now. We rely on VS Code logs and toast notifications for debugging.
