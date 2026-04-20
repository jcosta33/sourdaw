import { describe, it, expect, vi, beforeEach } from 'vitest';

import { foldTrack } from '../foldTrack';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('foldTrack', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should call updateTrack with a patch that sets collapsed', () => {
        foldTrack('t1', true);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: { collapsed: boolean; id: string }) => {
            collapsed: boolean;
            id: string;
        };
        expect(patch({ collapsed: false, id: 't1' })).toEqual({ collapsed: true, id: 't1' });
    });
});
