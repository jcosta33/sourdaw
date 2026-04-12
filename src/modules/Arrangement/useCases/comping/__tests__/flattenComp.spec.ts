import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTakeLane } from '../../../models/TakeLane';
import { flattenComp } from '../flattenComp';
import { takeLaneStore } from '../../../stores/takeLaneStore';

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        value: null,
        set: vi.fn(),
    },
}));

describe('flattenComp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no-ops when store is empty', () => {
        takeLaneStore.value = null as never;
        flattenComp('t1');
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('removes the lane for the track', () => {
        const laneA = createTakeLane('t1');
        const laneB = createTakeLane('t2');
        takeLaneStore.value = { lanes: [laneA, laneB] } as never;
        flattenComp('t1');
        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: unknown[] };
        expect(next.lanes).toHaveLength(1);
        expect(next.lanes[0]).toEqual(laneB);
    });
});
