# LY Perf Project Guidelines

## Architecture

- Keep the Electron process boundary clear: put ADB, filesystem, and OS integrations in `src/main`, expose them through preload and IPC, and keep cross-process contracts in `src/shared`.
- When adding new renderer features that need main-process data or side effects, extend the shared IPC/types layer first instead of importing main-only modules into renderer code.

## Change Strategy

- Prefer the most suitable solution over the smallest possible diff when improving behavior or maintainability.
- If multiple reasonable implementation directions exist and the tradeoff is unclear, ask the user before choosing one.

## Renderer UI And Styling

- For control or style improvements, prefer reusable components in `src/renderer/components` and shared styles over page-local inline changes.
- Follow the existing CSS Modules pattern in renderer code: import module styles with the default `styles` object.

## Build And Validation

- Use `npm start` for local development, `npm run typecheck` for TypeScript validation, `npm run build` for production bundles, and `npm run dist` for packaging.

## Conventions

- Keep renderer-main communication typed with shared channel/constants and shared types.
- Match the existing TypeScript and React style already used in the repo before introducing new patterns.