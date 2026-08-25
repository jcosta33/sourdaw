import { describe, it, expect, vi, beforeEach } from 'vitest';

type TrackStoreSubscribe = (typeof import('#/modules/Arrangement/stores'))['trackStore']['subscribe'];

const mocks = vi.hoisted(() => {
    const trackStoreValue: unknown = null;
    return { selectAllClipsInArrangement: vi.fn(), trackStoreValue };
});

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    selectAllClips: mocks.selectAllClipsInArrangement,
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackStoreValue;
        },
        subscribe: vi.fn<TrackStoreSubscribe>((_callback) => () => {}),
    },
}));

import { selectAllClips } from '../selectAllClips';

describe('selectAllClips', () => {
    beforeEach(() => {
        mocks.trackStoreValue = null;
        mocks.selectAllClipsInArrangement.mockReset();
    });

    it('delegates to the Arrangement selection use case with a getter for every clip id', () => {
        mocks.trackStoreValue = {
            tracks: [{ clips: [{ id: 'c1' }, { id: 'c2' }] }, { clips: [{ id: 'c3' }] }],
        };

        selectAllClips();

        expect(mocks.selectAllClipsInArrangement).toHaveBeenCalledTimes(1);
        const getAllClipIds = mocks.selectAllClipsInArrangement.mock.calls[0]![0] as () => string[];
        expect(getAllClipIds()).toEqual(['c1', 'c2', 'c3']);
    });

    it('handles empty arrangement', () => {
        mocks.trackStoreValue = { tracks: [] };
        selectAllClips();
        const getAllClipIds = mocks.selectAllClipsInArrangement.mock.calls[0]![0] as () => string[];
        expect(getAllClipIds()).toEqual([]);
    });
});
