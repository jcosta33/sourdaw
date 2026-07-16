import { describe, it, expect, vi, beforeEach } from 'vitest';

import { muteTrack } from '../muteTrack';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
    engineSetTrackMute: vi.fn(),
    applySoloLogic: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    setTrackMute: mocks.engineSetTrackMute,
}));

vi.mock('../applySoloLogic', () => ({
    applySoloLogic: mocks.applySoloLogic,
}));

describe('muteTrack', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates track muted state, notifies audio engine, and applies solo logic', () => {
        muteTrack('t1', true);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.engineSetTrackMute).toHaveBeenCalledWith('t1', true);
        expect(mocks.applySoloLogic).toHaveBeenCalledTimes(1);
    });
});
