import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toggleSoloSafe } from '../toggleSoloSafe';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
    applySoloLogic: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../applySoloLogic', () => ({
    applySoloLogic: mocks.applySoloLogic,
}));

describe('toggleSoloSafe', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should invert soloSafe on the track and apply solo routing', () => {
        toggleSoloSafe('t1');

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: { soloSafe: boolean; id: string }) => {
            soloSafe: boolean;
            id: string;
        };
        expect(patch({ soloSafe: false, id: 't1' })).toEqual({ soloSafe: true, id: 't1' });
        expect(patch({ soloSafe: true, id: 't1' })).toEqual({ soloSafe: false, id: 't1' });

        expect(mocks.applySoloLogic).toHaveBeenCalledTimes(1);
    });
});
