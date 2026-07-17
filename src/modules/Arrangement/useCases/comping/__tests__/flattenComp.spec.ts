import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState, takeLaneStore } from '../../../stores/takeLaneStore';
import { flattenComp } from '../flattenComp';

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

describe('flattenComp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no-ops when store is empty', () => {
        mocks.takeLaneStoreValue.value = null;
        flattenComp('t1');
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('removes the lane for the track', () => {
        const laneA = createTakeLane('t1');
        const laneB = createTakeLane('t2');
        mocks.takeLaneStoreValue.value = { lanes: [laneA, laneB] };
        flattenComp('t1');
        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: unknown[] };
        expect(next.lanes).toHaveLength(1);
        expect(next.lanes[0]).toEqual(laneB);
    });
});
