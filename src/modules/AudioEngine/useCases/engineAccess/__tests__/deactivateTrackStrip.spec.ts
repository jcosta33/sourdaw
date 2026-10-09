import { describe, it, expect, vi, beforeEach } from 'vitest';

import { deactivateTrackStrip } from '../deactivateTrackStrip';

const mocks = vi.hoisted(() => ({
    engineDeactivateTrackStrip: vi.fn<(trackId: string) => void>(),
    engineRemoveTrackStrip: vi.fn<(trackId: string) => void>(),
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        deactivateTrackStrip: mocks.engineDeactivateTrackStrip,
        removeTrackStrip: mocks.engineRemoveTrackStrip,
    },
}));

describe('deactivateTrackStrip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // The track stays in the project, so the strip must not go through the
    // removal that announces its devices as leaving.
    it('delegates the track id to the engine deactivation, never the track removal', () => {
        deactivateTrackStrip('folder-1');

        expect(mocks.engineDeactivateTrackStrip).toHaveBeenCalledTimes(1);
        expect(mocks.engineDeactivateTrackStrip).toHaveBeenCalledWith('folder-1');
        expect(mocks.engineRemoveTrackStrip).not.toHaveBeenCalled();
    });
});
