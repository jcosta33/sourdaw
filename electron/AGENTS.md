# electron/ — Agent Guidelines

Desktop application shell: main process lifecycle, preload security bridge, IPC router, native CLAP plugin GUI window management, and out-of-process scanner orchestration.

## Domain Ownership

- Owns desktop window lifecycle, window chrome IPC (`minimize`, `maximize`, `close`), and power-save blockers (`main.ts`).
- Owns desktop security policies (`security.ts`): CSP enforcement, context isolation (`contextIsolation: true`), node integration disablement (`nodeIntegration: false`), and navigation permission guards.
- Owns typed IPC routing (`router.ts`, `appIpc.ts`, `channels.ts`) and native addon bindings (`native.ts` linking `sourdaw-native`).
- Owns native CLAP plugin editor child window hosting (`pluginGui.ts`) and isolated plugin discovery child processes (`scan.ts`, `scanWorker.ts`).
- Does not own WebAudio graph logic (`src/modules/AudioEngine`) or React UI state.

## Security & Architecture Invariants

- **Strict IPC Confinement**: Renderer-to-main IPC messages pass strictly through `preload.ts` (`window.sourdawDesktopBridge`) and validated channels in `router.ts`. Bypassing channel validation or exposing raw Node/Electron APIs is strictly forbidden.
- **Frontend Boundary**: In the frontend renderer (`src/`), only `src/utils/desktopBridge.ts` and module repository roots may invoke desktop bridge APIs.
- **Child Window Ownership**: CLAP plugin GUI editor windows are managed as native OS child windows parented to the main browser window, destroyed cleanly upon plugin retirement.
- **Scan Process Isolation**: Plugin scanning must execute in detached child processes (`scanWorker.ts`) to prevent faulty third-party binaries from crashing the main Electron process.

## Verification

```bash
pnpm test:run electron/__tests__/
```
