import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTakeLane } from '../../../models/TakeLane';
import { addTake } from '../addTake';
import { takeLaneStore } from '../../../stores/takeLaneStore';

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        value: null,
        set: vi.fn(),
    },
}));

describe('addTake', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no-ops when lane store is empty', () => {
        takeLaneStore.value = null as never;
        addTake('t1', 'clip-1', 'Take 1', 0, 4);
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('appends a take on the matching lane', () => {
        const lane = createTakeLane('t1');
        takeLaneStore.value = { lanes: [lane] } as never;
        addTake('t1', 'clip-1', 'Take 1', 0, 4);
        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: typeof lane[] };
        expect(next.lanes[0]!.takes).toHaveLength(1);
        expect(next.lanes[0]!.takes[0]!.clipId).toBe('clip-1');
        expect(next.lanes[0]!.takes[0]!.name).toBe('Take 1');
    });
});
