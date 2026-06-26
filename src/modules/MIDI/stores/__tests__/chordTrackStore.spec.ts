import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

    it('falls back to the default state when the persisted shape is invalid', async () => {
        // `enabled` is the wrong type and an event is missing required fields —
        // an unchecked cast would have trusted this as a valid ChordTrackState.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: 'yes', events: [{ id: 'e1' }] }));

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('falls back to the default state when the persisted JSON is malformed', async () => {
        localStorage.setItem(STORAGE_KEY, '{ not valid json');

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });
});
