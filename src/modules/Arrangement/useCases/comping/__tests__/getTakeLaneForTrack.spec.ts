import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTakeLane } from '../../../models/TakeLane';
import { getTakeLaneForTrack } from '../getTakeLaneForTrack';
import { takeLaneStore } from '../../../stores/takeLaneStore';

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        value: null,
        set: vi.fn(),
    },
}));

describe('getTakeLaneForTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when store is empty', () => {
        takeLaneStore.value = null as never;
        expect(getTakeLaneForTrack('t1')).toBeNull();
    });

    it('returns the lane for the track id', () => {
        const lane = createTakeLane('t1');
        takeLaneStore.value = { lanes: [lane] } as never;
        expect(getTakeLaneForTrack('t1')).toEqual(lane);
        expect(getTakeLaneForTrack('missing')).toBeNull();
    });
});
