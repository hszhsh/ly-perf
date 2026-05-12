---
description: "Use when editing TypeScript under src/main or src/shared, especially IPC handlers, monitoring services, ADB integrations, and metric collection logic. Covers process boundaries, typed contracts, and performance-sensitive sampling behavior."
name: "Main And Shared Guidelines"
applyTo: ["src/main/**/*.ts", "src/shared/**/*.ts"]
---
# Main And Shared Guidelines

- Keep process boundaries explicit: main-process code owns ADB, filesystem, and Electron APIs; renderer-facing contracts belong in `src/shared` and flow through preload plus IPC.
- When adding or changing a renderer-to-main capability, update shared IPC channels and shared types as part of the same change.
- Prefer root-cause fixes and coherent structural changes over small local patches when working in monitor, session, or report services.
- Treat metric collection code as performance-sensitive: avoid repeated expensive shell scans inside hot sampling paths, prefer batching related probes, and preserve existing non-blocking patterns.
- Maintain strong typing across service, IPC, and renderer boundaries; avoid ad-hoc payload shapes when a shared type should exist.
- If a change introduces a meaningful architectural tradeoff, especially around sampling behavior or IPC shape, stop and ask the user before committing to one direction.