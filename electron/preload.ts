/**
 * The preload entry point (REQ-004).
 *
 * Unlike every other file here, this one is not run by `tsc`'s output. The
 * window uses `sandbox: true`, and Electron's sandboxed preload gets a
 * polyfilled `require` that resolves only `electron`, `events`, `timers` and
 * `url` — a relative import of a sibling file is not resolvable, so a sandboxed
 * preload has to be a single bundled CommonJS file. `scripts/buildElectronPreload.ts`
 * produces it, and `main.ts` loads that artifact by name.
 *
 * The file holds no behaviour of its own. `createSourdawBridge` builds the
 * object and this only hands it across the context boundary, so the bridge
 * stays testable against a fake `ipcRenderer` instead of a booted Electron.
 */
import { contextBridge, ipcRenderer } from 'electron';

import { createSourdawBridge } from './bridge.js';

contextBridge.exposeInMainWorld('sourdaw', createSourdawBridge(ipcRenderer));
