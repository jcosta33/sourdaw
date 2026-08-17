/**
 * Browser-safe desktop runtime markers.
 *
 * This file intentionally imports no Tauri API modules so browser-only
 * capability probes can detect the desktop shells without depending on IPC.
 */

/** True inside the Electron shell, where the preload published `window.sourdaw`. */
export const isSourdawRuntime = (): boolean => typeof window !== 'undefined' && 'sourdaw' in window;

/**
 * True when a native desktop IPC backend is reachable — the Electron bridge
 * (`window.sourdaw`, probed first) or the Tauri webview.
 *
 * The name predates the Electron shell. Every native-capability gate in the
 * repositories reads it as "is the native backend there", and that is the
 * question it answers; the rename lands with the breaking Tauri-removal wave
 * rather than as a 60-file sweep inside an additive change.
 */
export const isTauri = (): boolean =>
    isSourdawRuntime() || (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);

/** The honest name for what `isTauri` now answers; prefer it in new code. */
export const isDesktopRuntime = isTauri;
