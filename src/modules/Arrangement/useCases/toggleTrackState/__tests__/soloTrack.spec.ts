import { describe, it, expect, vi, beforeEach } from 'vitest';
import { soloTrack } from '../soloTrack';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
    applySoloLogic: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/Arrangement/services/applySoloLogic', () => ({
    applySoloLogic: mocks.applySoloLogic,
}));

describe('soloTrack', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates track soloed state and applies solo logic', () => {
        soloTrack('t1', true);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const updater = mocks.updateTrack.mock.calls[0][1];
        expect(updater({ soloed: false })).toEqual({ soloed: true });

        expect(mocks.applySoloLogic).toHaveBeenCalledTimes(1);
    });
});
