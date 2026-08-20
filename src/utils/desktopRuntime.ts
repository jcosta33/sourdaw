/**
 * Browser-safe desktop runtime markers.
 *
 * This file intentionally imports nothing so browser-only capability probes
 * can detect the desktop shell without depending on IPC.
 */

/** True inside the Electron shell, where the preload published `window.sourdaw`. */
export const isSourdawRuntime = (): boolean => typeof window !== 'undefined' && 'sourdaw' in window;

/**
 * True when a native desktop IPC backend is reachable. Every native-capability
 * gate in the repositories reads it as "is the native backend there".
 *
 * Today the only desktop shell is Electron, so this is `isSourdawRuntime`;
 * the two names stay separate because they answer different questions — a
 * future second shell changes this probe, not its callers.
 */
export const isDesktopRuntime = (): boolean => isSourdawRuntime();
