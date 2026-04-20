import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSoloTrack } from '../soloTrack';

const mocks = vi.hoisted(() => ({
    soloTrack: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/soloTrack', () => ({
    soloTrack: mocks.soloTrack,
}));

describe('handleSoloTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes soloTrack with payload', () => {
        handleSoloTrack.execute({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: true },
        });

        expect(mocks.soloTrack).toHaveBeenCalledWith('t1', true);
    });

    it('provides a description and inverse action based on soloed state', () => {
        const desc1 = handleSoloTrack.describe({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: true },
        });
        expect(desc1.label).toBe('Solo track');
        expect(desc1.inverseAction).toEqual({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: false },
        });

        const desc2 = handleSoloTrack.describe({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: false },
        });
        expect(desc2.label).toBe('Unsolo track');
        expect(desc2.inverseAction).toEqual({
            type: 'soloTrack',
            payload: { trackId: 't1', soloed: true },
        });
    });

    it('is undoable', () => {
        expect(handleSoloTrack.undoable).toBe(true);
    });
});
