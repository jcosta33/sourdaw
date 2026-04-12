import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGroupTracks } from '../groupTracks';

const mocks = vi.hoisted(() => ({
    groupTracks: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/groupTracks', () => ({
    groupTracks: mocks.groupTracks,
}));

describe('handleGroupTracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes groupTracks with the provided payload', () => {
        handleGroupTracks.execute({
            type: 'groupTracks',
            payload: { trackIds: ['t1', 't2'], name: 'Guitars' },
        });

        expect(mocks.groupTracks).toHaveBeenCalledWith(['t1', 't2'], 'Guitars');
    });

    it('provides a description reflecting the group name', () => {
        const desc = handleGroupTracks.describe({
            type: 'groupTracks',
            payload: { trackIds: ['t1', 't2'], name: 'Guitars' },
        });
        expect(desc.label).toBe('Group tracks: "Guitars"');
    });

    it('is undoable', () => {
        expect(handleGroupTracks.undoable).toBe(true);
    });
});
