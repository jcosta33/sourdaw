import { beforeEach, describe, expect, it } from 'vitest';

import { getState } from '../getState';
import { readPersistedInputId } from '../readPersistedInputId';
import { setState } from '../setState';

const STORAGE_KEY = 'sourdaw:midi:selectedInputId';

describe('setState', () => {
    beforeEach(() => {
        window.localStorage.clear();
        setState({ isSupported: true, inputs: [], selectedInputId: null });
        window.localStorage.clear();
    });

    it('remembers a selection the user made', () => {
        setState({ selectedInputId: 'launchkey' });

        expect(readPersistedInputId()).toBe('launchkey');
        expect(getState().selectedInputId).toBe('launchkey');
    });

    it('leaves the saved preference untouched for a session-only selection', () => {
        // A hot-unplug forces a stand-in device. Persisting it would rewrite
        // the user's choice to whatever happened to enumerate first, and
        // reconnecting the original would no longer restore it (#1837 F10).
        setState({ selectedInputId: 'launchkey' });

        setState({ selectedInputId: 'built-in-fallback' }, { persistSelection: false });

        expect(getState().selectedInputId).toBe('built-in-fallback');
        expect(readPersistedInputId()).toBe('launchkey');
    });

    it('does not clear the saved preference when a session-only update deselects', () => {
        setState({ selectedInputId: 'launchkey' });

        setState({ selectedInputId: null }, { persistSelection: false });

        expect(getState().selectedInputId).toBeNull();
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('launchkey');
    });

    it('clears the saved preference when the user deselects', () => {
        setState({ selectedInputId: 'launchkey' });

        setState({ selectedInputId: null });

        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('does not touch the saved preference for an update that carries no selection', () => {
        setState({ selectedInputId: 'launchkey' });

        setState({ inputs: [{ id: 'other', name: 'Other', manufacturer: 'Acme' }] });

        expect(readPersistedInputId()).toBe('launchkey');
    });
});
