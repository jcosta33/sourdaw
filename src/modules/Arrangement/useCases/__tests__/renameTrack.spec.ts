import { describe, it, expect, vi } from 'vitest';
import { renameTrack } from '../renameTrack';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
}));

vi.mock('../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('renameTrack', () => {
    it('should call updateTrack with a patch that sets the name', () => {
        renameTrack('t1', 'Renamed');

        expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: { name: string; id: string }) => {
            name: string;
            id: string;
        };
        expect(patch({ name: 'Old', id: 't1' })).toEqual({ name: 'Renamed', id: 't1' });
    });
});
