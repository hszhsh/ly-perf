# Repository Guidelines

## Project Structure & Module Organization

LY Perf is a Windows-focused Electron, React, TypeScript, and Rspack application for Android performance monitoring. Keep Electron and OS integrations in `src/main/`; ADB access lives in `src/main/adb`, while monitoring, session, and report logic lives in `src/main/services`. Put React pages, hooks, reusable components, and CSS Modules under `src/renderer`. Cross-process IPC constants, protocols, and types belong in `src/shared`; renderer code must reach main-process capabilities through the preload/IPC boundary.

Static HTML is in `public/`, bundled ADB binaries are in `resources/adb/win32/`, protocol documentation and Unity examples are in `docs/`, and development utilities are in `scripts/`. Generated output (`.rspack/`, `dist/`, and `release/`) should not be edited or committed.

## Build, Test, and Development Commands

- `npm install` installs the locked dependency set.
- `npm start` runs the renderer dev server, watches the main bundle, and launches Electron at port 3173.
- `npm run lint` checks TypeScript and TSX with ESLint.
- `npm run typecheck` runs strict TypeScript validation without emitting files.
- `npm run format:check` verifies Prettier formatting; `npm run format` applies it.
- `npm run build` creates production main and renderer bundles.
- `npm run dist` builds Windows NSIS and portable packages in `release/`.
- `npm run deep-monitor:mock` streams mock custom metrics to a running monitor session.

## Coding Style & Naming Conventions

Use four spaces in `.ts` and `.tsx`, double quotes, semicolons, and no trailing commas. Follow existing names: PascalCase for React components and classes, `useXxx` for hooks, camelCase for functions and variables, and `*.module.css` for component styles imported as `styles`. Prefer shared types over ad hoc IPC payloads and reusable renderer components over duplicated page-local controls.

## Testing Guidelines

There is currently no automated test framework or coverage threshold. Before submitting, run `npm run lint`, `npm run typecheck`, `npm run format:check`, and `npm run build`. Manually verify affected monitor/report flows; use a connected Android device for ADB changes and the mock client for deep-monitor protocol changes.

## Commit & Pull Request Guidelines

Recent commits use short, focused Chinese summaries describing the outcome (for example, `增加CSV导出`). Keep each commit cohesive and use the same concise, action-oriented style. Pull requests should explain the user-visible change, implementation scope, and validation performed; link relevant issues and include screenshots or recordings for UI changes. Call out IPC/protocol changes and packaging or device-specific risks explicitly.
