# aid-manager README

VS Code extension for editing scripts related to AI Dungeon.

## Features

Itemizes scenarios into a treeview allowing easier access to manage scripts.

## Requirements

VS Code version 1.102 or later

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `aid-manager.userName`: The username associated with the account you'd like top login to.
* `aid-manager.AIDEndpoint`: The endpoint for the AID environment you'd like to access.

## Known Issues

## Release Notes

### 1.0.0

Initial

## Webview UI

The scenario editor webview is now built with React. The source lives under `webview-ui/`.

- `npm run build:webview` – build the production assets into `media/scenario/dist` (automatically run before publishing).
- `npm run dev:webview` – start Vite in watch mode for rapid iteration inside the browser (useful for UI tweaks before syncing to VS Code).

The built assets are packaged with the extension, so make sure to re-run `npm run build:webview` whenever you update the React UI.
