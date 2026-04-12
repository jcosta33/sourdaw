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

        handleAddSidechainRoute.execute({
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });

        expect(mocks.addSidechainRoute).not.toHaveBeenCalled();
    });

    it('bails if the target track has no sidechain device', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 't2', devices: [{ id: 'd1', type: 'EQ' }] }
            ]
        });

        handleAddSidechainRoute.execute({
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 't1', targetTrackId: 't2' },
        });

        expect(mocks.addSidechainRoute).not.toHaveBeenCalled();
    });

    it('adds a route if a sidechain device exists', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 't2', devices: [{ id: 'd1', type: 'Compressor (Sidechain)' }] }
            ]
        });

        handleAddSidechainRoute.execute({
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

    it('is undoable', () => {
        expect(handleAddSidechainRoute.undoable).toBe(true);
    });
});
