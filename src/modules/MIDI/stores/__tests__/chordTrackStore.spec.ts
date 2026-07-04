import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { type ChordTrackState } from '../chordTrackStore';

const STORAGE_KEY = 'sourdaw_chord_track';

/**
 * `chordTrackStore` reads localStorage once at module load, so each case sets
 * the key, resets the module registry, and re-imports to exercise the loader.
 */
async function loadStore() {
    vi.resetModules();
    return import('../chordTrackStore');
}

describe('chordTrackStore localStorage loader', () => {
    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.removeItem(STORAGE_KEY);
    });

    it('loads a well-formed persisted state', async () => {
        const persisted = {
            enabled: true,
            events: [{ id: 'e1', beat: 0, root: 5, quality: 'major', duration: 4 }],
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

        const { chordTrackStore } = await loadStore();
        expect(chordTrackStore.value).toEqual(persisted);
    });

    it('should persist changes with the existing key and plain JSON shape', async () => {
        const { chordTrackStore } = await loadStore();
        const state = {
            enabled: true,
            events: [{ id: 'e1', beat: 0, root: 5, quality: 'major', duration: 4 }],
        } satisfies ChordTrackState;

        chordTrackStore.set(state);

        expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(state));
    });

    it('falls back to the default state when the persisted shape is invalid', async () => {
        // `enabled` is the wrong type and an event is missing required fields —
        // an unchecked cast would have trusted this as a valid ChordTrackState.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: 'yes', events: [{ id: 'e1' }] }));

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('should fall back to the default state when a persisted event has an invalid quality', async () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                enabled: true,
                events: [{ id: 'e1', beat: 0, root: 5, quality: 'custom', duration: 4 }],
            })
        );

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('should fall back when a persisted event quality is only an inherited object key', async () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                enabled: true,
                events: [{ id: 'e1', beat: 0, root: 5, quality: 'toString', duration: 4 }],
            })
        );

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('should fall back to the default state when a persisted event has a non-finite number', async () => {
        localStorage.setItem(
            STORAGE_KEY,
            '{"enabled":true,"events":[{"id":"e1","beat":1e999,"root":5,"quality":"major","duration":4}]}'
        );

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('falls back to the default state when the persisted JSON is malformed', async () => {
        localStorage.setItem(STORAGE_KEY, '{ not valid json');

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('should fall back to the default state when browser storage is unavailable', async () => {
        const browserStorage = window.localStorage;
        Object.defineProperty(window, 'localStorage', { configurable: true, value: undefined });

        try {
            const { chordTrackStore, defaultChordTrackState } = await loadStore();
            expect(chordTrackStore.value).toEqual(defaultChordTrackState);
        } finally {
            Object.defineProperty(window, 'localStorage', { configurable: true, value: browserStorage });
        }
    });

    it('should fall back to the default state when storage reads fail', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('read blocked');
        });

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('should not crash when storage writes fail', async () => {
        const { chordTrackStore } = await loadStore();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('write blocked');
        });

        expect(() => {
            chordTrackStore.set({
                enabled: true,
                events: [{ id: 'e1', beat: 0, root: 5, quality: 'major', duration: 4 }],
            });
        }).not.toThrow();
    });
});
