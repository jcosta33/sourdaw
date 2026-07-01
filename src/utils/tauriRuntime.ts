/**
 * Browser-safe Tauri runtime marker.
 *
 * This file intentionally imports no Tauri API modules so browser-only
 * capability probes can detect the desktop webview without depending on IPC.
 */
export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
