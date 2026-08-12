# Change Log

All notable changes to the "aid-manager" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.1.3]

- Add email/password authentication with automatic Firebase token refresh.
- Support manually supplied ID and refresh tokens, including whitespace validation.

## [0.1.2]

- Update AI Dungeon GraphQL calls for the current `state.scripts` scenario shape.
- Show script rows for pinned scenarios when the API reports scripts are enabled, even if the scenario also has options.
- Restore unauthenticated sign-in entry points in the AI Dungeon view and command palette.
- Trim pasted Firebase ID tokens and only mark sign-in successful after the token validates.
- Pin the VS Code extension test runner to the extension's declared compatibility version.

## [0.1.1]

- Fix activation issues in the Marketplace build (sign-in command now works).
- Add a cleaner Marketplace icon.

## [0.1.0]

- Initial release
