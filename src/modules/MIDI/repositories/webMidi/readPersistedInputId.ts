import {
    LEGACY_SELECTED_INPUT_ID_STORAGE_KEY,
    selectedInputIdStorageKey,
    type MidiIdentityScheme,
} from './selectedInputIdStorageKeys';

/**
 * Read the input preference of one identity scheme, never another scheme's.
 * While this scheme has not persisted yet, fall back to the legacy untagged
 * key so a pre-#4138 value still restores its device (one-way migration). The
 * fallback is not cleared here: a read cannot know which scheme the untagged
 * value came from, so retiring it is the next persist's job (`persistInputId`).
 */
export function readPersistedInputId(scheme: MidiIdentityScheme): string | null {
    try {
        const schemeValue = window.localStorage.getItem(selectedInputIdStorageKey(scheme));
        if (schemeValue !== null) {
            return schemeValue;
        }
        return window.localStorage.getItem(LEGACY_SELECTED_INPUT_ID_STORAGE_KEY);
    } catch {
        return null;
    }
}
