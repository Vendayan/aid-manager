# Aid Manager Vault

Welcome to the internal notes for the AI Dungeon Script Manager VS Code extension.  
Use this vault to keep track of how we authenticate with the AI Dungeon GraphQL API, how the extension is structured, and what workflows it enables.

## Quick Links
- [[architecture]] – extension layout, services, caching, and tree providers.
- [[ai-dungeon-api]] – GraphQL endpoints, auth headers, and the scripting payloads we read/write.
- [[workflows]] – how scenario discovery, editing, exporting, and saving operate within VS Code.
- [[design-notes]] – ongoing design decisions, UX goals, and open questions from discussions.

## Fast Facts
- Extension entry point: `src/extension.ts`.
- GraphQL client + auth: `src/AIDClient.ts` + `src/AuthService.ts`.
- Virtual FS for scripts + scenario JSON: `src/AIDFSProvider.ts`.
- Scenario tree UI + caching: `src/ScenarioTree.ts` + `src/LocalStore.ts`.

See [[workflows]] for end-to-end flows and troubleshooting tips.
