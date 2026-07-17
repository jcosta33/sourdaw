import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTakeLane } from '../../../models/TakeLane';
import { getTakeLaneForTrack } from '../getTakeLaneForTrack';

import type { TakeLaneStoreState } from '../../../stores/takeLaneStore';

const mocks = vi.hoisted(() => ({
    takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        set: vi.fn(),
    },
}));

describe('getTakeLaneForTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when store is empty', () => {
        mocks.takeLaneStoreValue.value = null;
        expect(getTakeLaneForTrack('t1')).toBeNull();
    });

    it('returns the lane for the track id', () => {
        const lane = createTakeLane('t1');
        mocks.takeLaneStoreValue.value = { lanes: [lane] };
        expect(getTakeLaneForTrack('t1')).toEqual(lane);
        expect(getTakeLaneForTrack('missing')).toBeNull();
    });
});
