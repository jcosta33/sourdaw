import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getPatternInstances } from '../getPatternInstances';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn<typeof import('#/modules/Arrangement/useCases').getTrackStoreState>(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('getPatternInstances', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return an empty list when the track store is missing', () => {
        mocks.getTrackStoreState.mockReturnValue(null);

        expect(getPatternInstances('parent')).toEqual([]);
    });

    it('should collect clip ids whose parent matches', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    clips: [
                        { id: 'a', parentClipId: 'x' },
                        { id: 'b', parentClipId: 'parent' },
                    ],
                },
            ],
        } as unknown as ReturnType<typeof import('#/modules/Arrangement/useCases').getTrackStoreState>);

        expect(getPatternInstances('parent')).toEqual(['b']);
    });
});
