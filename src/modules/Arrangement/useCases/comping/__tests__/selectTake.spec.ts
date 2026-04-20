import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTake, createTakeLane } from '../../../models/TakeLane';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { selectTake } from '../selectTake';

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        value: null,
        set: vi.fn(),
    },
}));

describe('selectTake', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no-ops when store is empty', () => {
        takeLaneStore.value = null as never;
        selectTake('t1', 'take-a');
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('marks the chosen take as selected on the track lane', () => {
        const takeA = createTake('c1', 'A', 0, 4);
        const takeB = createTake('c2', 'B', 0, 4);
        const lane = { ...createTakeLane('t1'), takes: [takeA, takeB] };
        takeLaneStore.value = { lanes: [lane] } as never;
        selectTake('t1', takeB.id);
        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: (typeof lane)[] };
        const updated = next.lanes[0]!;
        expect(updated.takes.find((t) => t.id === takeA.id)?.selected).toBe(false);
        expect(updated.takes.find((t) => t.id === takeB.id)?.selected).toBe(true);
    });
});
