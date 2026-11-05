import { logger } from '../logger/appLogger';

let layoutMap: ReadonlyMap<string, string> | null = null;
let pendingRequest: Promise<void> | null = null;

/**
 * Starts reading the active keyboard layout through the Keyboard Map API, so
 * shortcut matching and shortcut capture resolve a physical key to the same
 * character. Idempotent while a request is in flight; a later call refreshes
 * the map after a layout switch. Leaves the map unset where the API is absent
 * or refused (a cross-origin frame without the `keyboard-map` policy).
 */
export function loadKeyboardLayoutMap(): Promise<void> {
    const keyboard = globalThis.navigator?.keyboard;
    if (pendingRequest || !keyboard) {
        return pendingRequest ?? Promise.resolve();
    }
    pendingRequest = keyboard
        .getLayoutMap()
        .then((map) => {
            layoutMap = map;
        })
        .catch((error: unknown) => {
            logger.warn('Keyboard layout map unavailable; shortcuts fall back to US physical keys', error);
        })
        .finally(() => {
            pendingRequest = null;
        });
    return pendingRequest;
}

/** The last loaded layout map, or null before it loads or where the API is unavailable. */
export function currentKeyboardLayoutMap(): ReadonlyMap<string, string> | null {
    return layoutMap;
}
