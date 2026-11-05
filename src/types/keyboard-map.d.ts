/**
 * Keyboard Map API surface that Chromium (and so Electron) ships at runtime but
 * TypeScript's DOM lib omits. Optional on `Navigator` because other engines and
 * jsdom lack it, so callers must handle its absence.
 *
 * Shape follows the WICG Keyboard Map spec:
 * https://wicg.github.io/keyboard-map/
 */

interface Keyboard {
    /** Resolves to the unmodified character each writing-system `KeyboardEvent.code` produces on the active layout. */
    getLayoutMap(): Promise<ReadonlyMap<string, string>>;
}

interface Navigator {
    readonly keyboard?: Keyboard;
}
