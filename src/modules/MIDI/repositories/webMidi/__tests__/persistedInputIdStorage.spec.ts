import { beforeEach, describe, expect, it } from 'vitest';

import { persistInputId } from '../persistInputId';
import { readPersistedInputId } from '../readPersistedInputId';
import {
    LEGACY_SELECTED_INPUT_ID_STORAGE_KEY,
    NATIVE_IDENTITY_SCHEME,
    WEB_MIDI_IDENTITY_SCHEME,
    selectedInputIdStorageKey,
} from '../selectedInputIdStorageKeys';

/**
 * Pins the persisted input preference at the real storage boundary: each
 * identity scheme owns its own key, a scheme id never resolves against the
 * other scheme's key, and the legacy untagged key is a one-way migration
 * source retired by the next persist (#4138).
 */
describe('per-scheme persisted input id', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('writes each scheme to its own key and reads it back only there', () => {
        persistInputId('web-id', WEB_MIDI_IDENTITY_SCHEME);
        persistInputId('native-id', NATIVE_IDENTITY_SCHEME);

        expect(window.localStorage.getItem(selectedInputIdStorageKey(WEB_MIDI_IDENTITY_SCHEME))).toBe('web-id');
        expect(window.localStorage.getItem(selectedInputIdStorageKey(NATIVE_IDENTITY_SCHEME))).toBe('native-id');
        expect(readPersistedInputId(WEB_MIDI_IDENTITY_SCHEME)).toBe('web-id');
        expect(readPersistedInputId(NATIVE_IDENTITY_SCHEME)).toBe('native-id');
    });

    it('never resolves a Web MIDI id against the native key or the reverse', () => {
        persistInputId('web-id', WEB_MIDI_IDENTITY_SCHEME);

        expect(readPersistedInputId(NATIVE_IDENTITY_SCHEME)).toBeNull();

        persistInputId('native-id', NATIVE_IDENTITY_SCHEME);

        expect(readPersistedInputId(WEB_MIDI_IDENTITY_SCHEME)).toBe('web-id');
        expect(readPersistedInputId(NATIVE_IDENTITY_SCHEME)).toBe('native-id');
    });

    it('clears a scheme key when that scheme persists a deselection', () => {
        persistInputId('web-id', WEB_MIDI_IDENTITY_SCHEME);

        persistInputId(null, WEB_MIDI_IDENTITY_SCHEME);

        expect(readPersistedInputId(WEB_MIDI_IDENTITY_SCHEME)).toBeNull();
        expect(readPersistedInputId(NATIVE_IDENTITY_SCHEME)).toBeNull();
    });

    it('serves a legacy untagged value once as a migration read and clears it on the next persist', () => {
        window.localStorage.setItem(LEGACY_SELECTED_INPUT_ID_STORAGE_KEY, 'pre-4138-id');

        // The untagged value answers for the scheme whose key is still empty,
        // so an upgrading user keeps their device.
        expect(readPersistedInputId(WEB_MIDI_IDENTITY_SCHEME)).toBe('pre-4138-id');

        persistInputId('web-id', WEB_MIDI_IDENTITY_SCHEME);

        expect(window.localStorage.getItem(LEGACY_SELECTED_INPUT_ID_STORAGE_KEY)).toBeNull();
        expect(readPersistedInputId(WEB_MIDI_IDENTITY_SCHEME)).toBe('web-id');
    });

    it('retires the legacy value by a persist in the other scheme as well', () => {
        // The untagged key named no scheme, so any namespaced write retires it:
        // leaving it in place would keep resolving an id of unknown origin
        // against both transports.
        window.localStorage.setItem(LEGACY_SELECTED_INPUT_ID_STORAGE_KEY, 'pre-4138-id');

        persistInputId('native-id', NATIVE_IDENTITY_SCHEME);

        expect(window.localStorage.getItem(LEGACY_SELECTED_INPUT_ID_STORAGE_KEY)).toBeNull();
        expect(readPersistedInputId(WEB_MIDI_IDENTITY_SCHEME)).toBeNull();
        expect(readPersistedInputId(NATIVE_IDENTITY_SCHEME)).toBe('native-id');
    });

    it('clears the legacy key even when the persist is a deselection', () => {
        window.localStorage.setItem(LEGACY_SELECTED_INPUT_ID_STORAGE_KEY, 'pre-4138-id');

        persistInputId(null, NATIVE_IDENTITY_SCHEME);

        expect(window.localStorage.getItem(LEGACY_SELECTED_INPUT_ID_STORAGE_KEY)).toBeNull();
    });
});
