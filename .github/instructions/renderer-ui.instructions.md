---
description: "Use when editing React renderer pages, components, or CSS Modules in src/renderer. Covers reusable component extraction, shared styling, and matching the repo's TSX + CSS Modules patterns."
name: "Renderer UI Guidelines"
applyTo: "src/renderer/**/*.{ts,tsx,css}"
---
# Renderer UI Guidelines

- Prefer extracting reusable controls into `src/renderer/components` instead of solving a page-specific UI problem inline inside a page component.
- When a style change can be shared, move it into a reusable component style or shared module pattern instead of duplicating page-local CSS.
- Keep renderer styling in CSS Modules and consume them through the default `styles` import pattern already used in the repo.
- Match existing React component style in this codebase before introducing new abstractions; prefer straightforward state and effects over premature indirection.
- If a UI optimization could reasonably be implemented either as a local tweak or a reusable primitive, choose the reusable primitive unless that would clearly overfit the current need.
