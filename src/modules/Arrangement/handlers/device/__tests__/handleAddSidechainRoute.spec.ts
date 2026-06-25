import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAddSidechainRoute } from '../handleAddSidechainRoute';

const mocks = vi.hoisted(() => ({
    addSidechainRoute: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Routing/useCases', () => ({
    addSidechainRoute: mocks.addSidechainRoute,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleAddSidechainRoute', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bails if the target track cannot be found', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        void handleAddSidechainRoute.execute({
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });

        expect(mocks.addSidechainRoute).not.toHaveBeenCalled();
    });

    it('bails if the target track has no sidechain device', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't2', devices: [{ id: 'd1', type: 'EQ' }] }],
        });

        void handleAddSidechainRoute.execute({
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });

        expect(mocks.addSidechainRoute).not.toHaveBeenCalled();
    });

    it('adds a route if a sidechain device exists', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't2', devices: [{ id: 'd1', type: 'Compressor (Sidechain)' }] }],
        });

        void handleAddSidechainRoute.execute({
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });

        expect(mocks.addSidechainRoute).toHaveBeenCalledWith('t1', 't2', 'd1');
    });

    it('provides a description', () => {
        const desc = handleAddSidechainRoute.describe({
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });
        expect(desc.label).toBe('Add sidechain route');
    });

    // Regression: undo must re-derive engine wiring rather than rely on a CRDT store
    // revert. The undo engine replays `describe().inverseAction`; without the inverse
    // `removeSidechainRoute`, undo is an inert no-op that leaves the route wired and in
    // the post-add store. Asserting the inverse is the public seam that proves undo
    // un-wires the route through the same use case that added it.
    it('describes the inverse removeSidechainRoute so undo unwires the route', () => {
        const desc = handleAddSidechainRoute.describe({
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });
        expect(desc.inverseAction).toEqual({
            type: 'removeSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });
    });

    it('is undoable', () => {
        expect(handleAddSidechainRoute.undoable).toBe(true);
    });
});
