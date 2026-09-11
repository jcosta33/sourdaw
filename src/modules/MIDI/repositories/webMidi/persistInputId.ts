import {
    LEGACY_SELECTED_INPUT_ID_STORAGE_KEY,
    selectedInputIdStorageKey,
    type MidiIdentityScheme,
} from './selectedInputIdStorageKeys';

/**
 * Persist the input preference under the key of the scheme that produced the
 * id, and retire the legacy untagged key: it names no scheme, so once a
 * namespaced write exists the untagged value must never answer a read again —
 * otherwise it would keep resolving across schemes (#4138).
 */
export function persistInputId(id: string | null, scheme: MidiIdentityScheme): void {
    try {
        if (id) {
            window.localStorage.setItem(selectedInputIdStorageKey(scheme), id);
        } else {
            window.localStorage.removeItem(selectedInputIdStorageKey(scheme));
        }
        window.localStorage.removeItem(LEGACY_SELECTED_INPUT_ID_STORAGE_KEY);
    } catch {
        // storage not available
    }
}
