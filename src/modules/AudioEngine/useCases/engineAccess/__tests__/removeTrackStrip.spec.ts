import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeTrackStrip } from '../removeTrackStrip';

const mocks = vi.hoisted(() => ({
    engineRemoveTrackStrip: vi.fn<(trackId: string) => void>(),
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        removeTrackStrip: mocks.engineRemoveTrackStrip,
    },
}));

describe('removeTrackStrip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates the track id to the engine repository', () => {
        removeTrackStrip('t1');

        expect(mocks.engineRemoveTrackStrip).toHaveBeenCalledTimes(1);
        expect(mocks.engineRemoveTrackStrip).toHaveBeenCalledWith('t1');
    });
});
