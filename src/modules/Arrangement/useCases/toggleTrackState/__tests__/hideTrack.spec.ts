import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hideTrack } from '../hideTrack';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('hideTrack', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should call updateTrack with a patch that sets hidden', () => {
        hideTrack('t1', true);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: { hidden: boolean; id: string }) => {
            hidden: boolean;
            id: string;
        };
        expect(patch({ hidden: false, id: 't1' })).toEqual({ hidden: true, id: 't1' });
    });
});
