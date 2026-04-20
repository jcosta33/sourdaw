import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { acceptGhostClip } from '#/modules/Arrangement/useCases/clip/acceptGhostClip';
import { updateTrack } from '#/modules/Arrangement/useCases/updateTrack';

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: {
        value: {
            tracks: [{ id: 't1', clips: [] }],
            ghostClips: [
                {
                    id: 'g1',
                    trackId: 't1',
                    startBeat: 0,
                    endBeat: 4,
                    name: 'Ghost',
                    type: 'audio' as const,
                    fadeInBeats: 0,
                    fadeOutBeats: 0,
                    gain: 1,
                    color: 'blue',
                    locked: false,
                    muted: false,
                },
            ],
        },
        set: vi.fn(),
    },
}));

vi.mock('#/modules/Arrangement/useCases/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

describe('acceptGhostClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should move ghost clip to track and remove from ghost list', () => {
        acceptGhostClip('g1');
        expect(vi.mocked(updateTrack)).toHaveBeenCalledWith('t1', expect.any(Function));
    });

    it('should handle legacy ghost-flag acceptance', () => {
        const state = trackStore.value as any;
        state.ghostClips = [];
        state.tracks = [{ id: 't1', clips: [{ id: 'c1', isGhost: true }] }];

        acceptGhostClip('c1');
        expect(vi.mocked(updateTrack)).toHaveBeenCalledWith('t1', expect.any(Function));
    });
});
