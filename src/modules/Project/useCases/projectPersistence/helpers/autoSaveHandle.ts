/**
 * Shared handle to the active CRDT auto-save subscription.
 *
 * Both `newProject()` and `loadProject()` call `startCrdtAutoSave()` and
 * need to cancel any previous subscription before starting a new one.
 * Prior to this helper each file held its own local `stopAutoSave` binding,
 * which meant `newProject → loadProject` would leak the first auto-save loop.
 */

let stopAutoSave: (() => void) | null = null;

export function setAutoSaveHandle(handle: (() => void) | null): void {
    stopAutoSave = handle;
}

export function stopActiveAutoSave(): void {
    if (stopAutoSave) {
        stopAutoSave();
        stopAutoSave = null;
    }
}
