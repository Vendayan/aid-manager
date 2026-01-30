# AI Dungeon Script Manager

VS Code extension for editing scripts related to AI Dungeon.

## Features

- Itemizes scenarios into a treeview allowing easier access to manage scripts.
- Command palette action to look up any published scenario by ID (`Lookup Scenario by ID`) and pin it in the tree

## Extension Settings

This extension contributes the following settings:

* `aid-manager.userName`: The username associated with the account you want to log in as.
* `aid-manager.AIDEndpoint`: The GraphQL endpoint for the AI Dungeon API.
* `aid-manager.firebaseApiKey`: Public Firebase API key (do not change).
* `aid-manager.authHeaderName`: HTTP header name for auth (do not change).
* `aid-manager.authHeaderFormat`: Auth header value format (do not change).

## Known Issues

## Release Notes

### 0.1.1

- Fix activation issues in the Marketplace build (sign-in command now works).
- Add a cleaner Marketplace icon.

### 0.1.0

- Initial release

## Webview UI

The scenario editor webview is now built with React. The source lives under `webview-ui/`.

- `npm run build:webview` — build the production assets into `media/scenario/dist` (automatically run before publishing).
- `npm run dev:webview` — start Vite in watch mode for rapid iteration inside the browser (useful for UI tweaks before syncing to VS Code).

The built assets are packaged with the extension, so make sure to re-run `npm run build:webview` whenever you update the React UI.
