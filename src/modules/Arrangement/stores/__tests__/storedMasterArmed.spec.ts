import { describe, expect, it } from 'vitest';

import { sanitizeTrackSnapshot } from '../trackStore';

/**
 * `sanitizeTrackSnapshot` is the projection both a project load
 * (`restoreTrackSnapshot`) and a CRDT hydrate or remote change go through, so a
 * fixture pushed through it is a stored or peer document arriving.
 */
describe('stored master armed state', () => {
    const stored = {
        tracks: [
            { id: 'master', name: 'Master', kind: 'master', armed: true },
            { id: 'audio-1', name: 'Audio 1', kind: 'audio', armed: true },
        ],
        selectedTrackId: null,
    };

    it('projects a master stored as armed to disarmed', () => {
        const master = sanitizeTrackSnapshot(stored).tracks.find((track) => track.id === 'master');

        expect(master?.armed).toBe(false);
    });

    it('keeps an ordinary stored-armed track armed', () => {
        const audio = sanitizeTrackSnapshot(stored).tracks.find((track) => track.id === 'audio-1');

        expect(audio?.armed).toBe(true);
    });
});
