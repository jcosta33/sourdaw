import { describe, it, expect, vi, beforeEach } from 'vitest';

import { reorderTrack } from '../reorderTrack';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateTrackState: vi.fn(),
    setTrackOutput: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackOutput: mocks.setTrackOutput,
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrackState', () => ({
    updateTrackState: mocks.updateTrackState,
}));

describe('reorderTrack', () => {
    beforeEach(() => vi.clearAllMocks());

    it('reorders tracks by moving a track to a new index', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
        });

        // Move t1 to index 1 (between t2 and t3)
        reorderTrack('t1', 1);

        expect(mocks.updateTrackState).toHaveBeenCalledWith({
            tracks: [{ id: 't2' }, { id: 't1' }, { id: 't3' }],
        });
    });

    it('refreshes live Toaster pad indexes after reordering sibling stems', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 'parent', parentId: null, devices: [{ type: 'toaster' }] },
                { id: 'stem-1', parentId: 'parent', devices: [], outputId: 'parent' },
                { id: 'stem-2', parentId: 'parent', devices: [], outputId: 'parent' },
            ],
        });

        reorderTrack('stem-1', 2);

        expect(mocks.setTrackOutput).toHaveBeenNthCalledWith(1, 'stem-2', 'parent');
        expect(mocks.setTrackOutput).toHaveBeenNthCalledWith(2, 'stem-1', 'parent');
        expect(mocks.setTrackOutput).toHaveBeenNthCalledWith(3, 'stem-2', 'parent', {
            toasterParentTrackId: 'parent',
            padIndex: 0,
        });
        expect(mocks.setTrackOutput).toHaveBeenNthCalledWith(4, 'stem-1', 'parent', {
            toasterParentTrackId: 'parent',
            padIndex: 1,
        });
        expect(mocks.updateTrackState.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.setTrackOutput.mock.invocationCallOrder[0]!
        );
    });

    it('disconnects a stale pad route when a reordered stem moves beyond pad 16', () => {
        const stems = Array.from({ length: 17 }, (_, index) => ({
            id: `stem-${index}`,
            parentId: 'parent',
            devices: [],
            outputId: 'parent',
        }));
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'parent', parentId: null, devices: [{ type: 'toaster' }] }, ...stems],
        });

        reorderTrack('stem-0', 17);

        expect(mocks.setTrackOutput).toHaveBeenCalledWith('stem-0', 'parent');
    });

    it('moves track to the end if newIndex is high', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1' }, { id: 't2' }],
        });

        reorderTrack('t1', 10);

        expect(mocks.updateTrackState).toHaveBeenCalledWith({
            tracks: [{ id: 't2' }, { id: 't1' }],
        });
    });

    it('bails if track not found', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1' }] });
        reorderTrack('missing', 0);
        expect(mocks.updateTrackState).not.toHaveBeenCalled();
    });
});
