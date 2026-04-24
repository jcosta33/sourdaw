import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getPatternInstances } from '../getPatternInstances';

const mocks = vi.hoisted(() => ({
    trackStore: { value: null },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: mocks.trackStore,
}));

describe('getPatternInstances', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return an empty list when the track store is missing', () => {
        mocks.trackStore.value = null;

        expect(getPatternInstances('parent')).toEqual([]);
    });

    it('should collect clip ids whose parent matches', () => {
        mocks.trackStore.value = {
            tracks: [
                {
                    clips: [
                        { id: 'a', parentClipId: 'x' },
                        { id: 'b', parentClipId: 'parent' },
                    ],
                },
            ],
        };

        expect(getPatternInstances('parent')).toEqual(['b']);
    });
});
