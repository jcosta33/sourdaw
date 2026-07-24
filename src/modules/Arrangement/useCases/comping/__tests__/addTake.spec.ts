import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState, takeLaneStore } from '../../../stores/takeLaneStore';
import { addTake } from '../addTake';

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

describe('addTake', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no-ops when lane store is empty', () => {
        mocks.takeLaneStoreValue.value = null;
        addTake('t1', 'clip-1', 'Take 1', 0, 4);
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('appends a take on the matching lane', () => {
        const lane = createTakeLane('t1');
        mocks.takeLaneStoreValue.value = { lanes: [lane] };
        addTake('t1', 'clip-1', 'Take 1', 0, 4);
        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: (typeof lane)[] };
        expect(next.lanes[0]!.takes).toHaveLength(1);
        expect(next.lanes[0]!.takes[0]!.clipId).toBe('clip-1');
        expect(next.lanes[0]!.takes[0]!.name).toBe('Take 1');
    });

    it('appends only to the matching lane and leaves unrelated lanes untouched', () => {
        const matchingLane = createTakeLane('t1');
        const otherLane = {
            ...createTakeLane('t2'),
            takes: [{ id: 'existing', clipId: 'c2', name: 'Old', startBeat: 0, endBeat: 4, selected: true }],
        };
        mocks.takeLaneStoreValue.value = { lanes: [matchingLane, otherLane] };

        addTake('t1', 'clip-1', 'Take 1', 0, 4);

        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: ReturnType<typeof createTakeLane>[] };
        // The unrelated t2 lane passes through the map short-circuit unchanged.
        expect(next.lanes[1]!.takes).toHaveLength(1);
        expect(next.lanes[1]!.takes[0]!.clipId).toBe('c2');
        expect(next.lanes[0]!.takes).toHaveLength(1);
    });
});
