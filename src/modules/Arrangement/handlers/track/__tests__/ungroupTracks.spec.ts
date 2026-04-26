import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleUngroupTracks } from '../ungroupTracks';

const mocks = vi.hoisted(() => ({
    ungroupTracks: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/ungroupTracks', () => ({
    ungroupTracks: mocks.ungroupTracks,
}));

describe('handleUngroupTracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes ungroupTracks with the provided payload', () => {
        void handleUngroupTracks.execute({
            type: 'ungroupTracks',
            payload: { groupId: 'g1' },
        });

        expect(mocks.ungroupTracks).toHaveBeenCalledWith('g1');
    });

    it('provides a description', () => {
        const desc = handleUngroupTracks.describe({
            type: 'ungroupTracks',
            payload: { groupId: 'g1' },
        });
        expect(desc.label).toBe('Ungroup tracks');
    });

    it('is undoable', () => {
        expect(handleUngroupTracks.undoable).toBe(true);
    });
});
