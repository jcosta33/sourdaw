import { beforeEach, describe, expect, it } from 'vitest';

import { getState } from '../getState';
import { readPersistedInputId } from '../readPersistedInputId';
import { WEB_MIDI_IDENTITY_SCHEME, selectedInputIdStorageKey } from '../selectedInputIdStorageKeys';
import { setState } from '../setState';

const STORAGE_KEY = selectedInputIdStorageKey(WEB_MIDI_IDENTITY_SCHEME);
const PERSIST_WEB = { persistSelection: true, identityScheme: WEB_MIDI_IDENTITY_SCHEME } as const;

describe('setState', () => {
    beforeEach(() => {
        window.localStorage.clear();
        setState({ isSupported: true, inputs: [], selectedInputId: null }, PERSIST_WEB);
        window.localStorage.clear();
    });

    it('remembers a selection the user made', () => {
        setState({ selectedInputId: 'launchkey' }, PERSIST_WEB);

        expect(readPersistedInputId(WEB_MIDI_IDENTITY_SCHEME)).toBe('launchkey');
        expect(getState().selectedInputId).toBe('launchkey');
    });

    it('leaves the saved preference untouched for a session-only selection', () => {
        // A hot-unplug forces a stand-in device. Persisting it would rewrite
        // the user's choice to whatever happened to enumerate first, and
        // reconnecting the original would no longer restore it (#1837 F10).
        setState({ selectedInputId: 'launchkey' }, PERSIST_WEB);

        setState({ selectedInputId: 'built-in-fallback' }, { persistSelection: false });

        expect(getState().selectedInputId).toBe('built-in-fallback');
        expect(readPersistedInputId(WEB_MIDI_IDENTITY_SCHEME)).toBe('launchkey');
    });

    it('does not clear the saved preference when a session-only update deselects', () => {
        setState({ selectedInputId: 'launchkey' }, PERSIST_WEB);

        setState({ selectedInputId: null }, { persistSelection: false });

        expect(getState().selectedInputId).toBeNull();
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('launchkey');
    });

    it('clears the saved preference when the user deselects', () => {
        setState({ selectedInputId: 'launchkey' }, PERSIST_WEB);

        setState({ selectedInputId: null }, PERSIST_WEB);

        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('does not touch the saved preference for an update that carries no selection', () => {
        setState({ selectedInputId: 'launchkey' }, PERSIST_WEB);

        setState({ inputs: [{ id: 'other', name: 'Other', manufacturer: 'Acme' }] });

        expect(readPersistedInputId(WEB_MIDI_IDENTITY_SCHEME)).toBe('launchkey');
    });

    describe('access denial', () => {
        it('keeps a denial through writes that leave the enumeration error alone', () => {
            setState({ enumerationError: 'Permission denied', accessDenied: true });

            setState({ inputs: [] });

            expect(getState().accessDenied).toBe(true);
        });

        it('clears a denial when the error is cleared without naming a cause', () => {
            setState({ enumerationError: 'Permission denied', accessDenied: true });

            setState({ enumerationError: null, enumerationCompleted: true });

            expect(getState()).toMatchObject({ enumerationError: null, accessDenied: false });
        });

        it('clears a denial when a different failure replaces it', () => {
            setState({ enumerationError: 'Permission denied', accessDenied: true });

            setState({ enumerationError: 'native port closed' });

            expect(getState().accessDenied).toBe(false);
        });
    });
});
