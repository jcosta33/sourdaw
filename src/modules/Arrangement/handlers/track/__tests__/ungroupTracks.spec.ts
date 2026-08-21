import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleUngroupTracks } from '../ungroupTracks';

const mocks = vi.hoisted(() => ({
    ungroupTracks: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/ungroupTracks', () => ({
    ungroupTracks: mocks.ungroupTracks,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

function setTracks(tracks: Array<{ id: string; groupId: string | null }>) {
    mocks.getTrackStoreState.mockReturnValue({ tracks });
}

describe('handleUngroupTracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setTracks([
            { id: 't1', groupId: 'g1' },
            { id: 't2', groupId: 'g1' },
            { id: 't3', groupId: 'g2' },
        ]);
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

    it('captures every track carrying the group id as the inverse replacement', () => {
        const description = handleUngroupTracks.describe({
            type: 'ungroupTracks',
            payload: { groupId: 'g1' },
        });

        expect(description.inverseAction).toEqual({
            type: 'restoreTrackGroupMemberships',
            payload: {
                expected: [
                    { trackId: 't1', groupId: null },
                    { trackId: 't2', groupId: null },
                ],
                replacement: [
                    { trackId: 't1', groupId: 'g1' },
                    { trackId: 't2', groupId: 'g1' },
                ],
            },
        });
        // Expected/replacement swap for redo.
        expect(description.redoAction).toEqual({
            type: 'restoreTrackGroupMemberships',
            payload: {
                expected: [
                    { trackId: 't1', groupId: 'g1' },
                    { trackId: 't2', groupId: 'g1' },
                ],
                replacement: [
                    { trackId: 't1', groupId: null },
                    { trackId: 't2', groupId: null },
                ],
            },
        });
    });

    it('emits no inverse when no track carries the group id', () => {
        expect(
            handleUngroupTracks.describe({
                type: 'ungroupTracks',
                payload: { groupId: 'missing' },
            })
        ).toEqual({ label: 'Ungroup tracks', inverseAction: null });
    });

    it('returns no-write when no track carries the group id', () => {
        expect(
            handleUngroupTracks.execute({
                type: 'ungroupTracks',
                payload: { groupId: 'missing' },
            })
        ).toEqual({ status: 'no-write' });
        expect(mocks.ungroupTracks).not.toHaveBeenCalled();
    });

    it('reports a no-op when no track carries the group id', () => {
        expect(
            handleUngroupTracks.isNoop?.({
                type: 'ungroupTracks',
                payload: { groupId: 'missing' },
            })
        ).toBe(true);
    });

    it('is not a no-op when a track carries the group id', () => {
        expect(
            handleUngroupTracks.isNoop?.({
                type: 'ungroupTracks',
                payload: { groupId: 'g1' },
            })
        ).toBe(false);
    });
});
