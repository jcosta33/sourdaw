import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRemoveSidechainRoute } from '../handleRemoveSidechainRoute';

const mocks = vi.hoisted(() => ({
    getSidechainRoutesForTrack: vi.fn(),
    removeSidechainRoute: vi.fn(),
}));

vi.mock('#/modules/Routing/useCases', () => ({
    getSidechainRoutesForTrack: mocks.getSidechainRoutesForTrack,
    removeSidechainRoute: mocks.removeSidechainRoute,
}));

describe('handleRemoveSidechainRoute', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bails if the route cannot be found for the target track', () => {
        mocks.getSidechainRoutesForTrack.mockReturnValue([]);

        handleRemoveSidechainRoute.execute({
            type: 'removeSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });

        expect(mocks.removeSidechainRoute).not.toHaveBeenCalled();
    });

    it('removes the sidechain route if it matches the source track', () => {
        mocks.getSidechainRoutesForTrack.mockReturnValue([
            { id: 'r1', sourceTrackId: 't1' },
            { id: 'r2', sourceTrackId: 't3' },
        ]);

        handleRemoveSidechainRoute.execute({
            type: 'removeSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });

        expect(mocks.removeSidechainRoute).toHaveBeenCalledWith('r1');
    });

    it('provides a description', () => {
        const desc = handleRemoveSidechainRoute.describe({
            type: 'removeSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });
        expect(desc.label).toBe('Remove sidechain route');
    });

    it('is undoable', () => {
        expect(handleRemoveSidechainRoute.undoable).toBe(true);
    });
});
