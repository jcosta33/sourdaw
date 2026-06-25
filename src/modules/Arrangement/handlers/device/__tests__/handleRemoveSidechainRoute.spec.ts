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

        void handleRemoveSidechainRoute.execute({
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

        void handleRemoveSidechainRoute.execute({
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

    // Regression: undo must re-derive engine wiring rather than rely on a CRDT store
    // revert. The undo engine replays `describe().inverseAction`; without the inverse
    // `addSidechainRoute`, undo is an inert no-op that leaves the route unwired and absent
    // from the store. Asserting the inverse is the public seam that proves undo re-wires
    // the route through the same use case that removed it.
    it('describes the inverse addSidechainRoute so undo rewires the route', () => {
        const desc = handleRemoveSidechainRoute.describe({
            type: 'removeSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });
        expect(desc.inverseAction).toEqual({
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });
    });

    it('is undoable', () => {
        expect(handleRemoveSidechainRoute.undoable).toBe(true);
    });
});
