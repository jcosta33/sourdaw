import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTakeLane } from '#/modules/Arrangement/models/TakeLane';
import { addTakeLane } from '../addTakeLane';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';

vi.mock('#/modules/Arrangement/stores/takeLaneStore', () => ({
    takeLaneStore: {
        value: null,
        set: vi.fn(),
    },
}));

describe('addTakeLane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no-ops when store is empty', () => {
        takeLaneStore.value = null as never;
        addTakeLane('t1');
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('adds a lane when missing', () => {
        takeLaneStore.value = { lanes: [] } as never;
        addTakeLane('t1');
        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: unknown[] };
        expect(next.lanes).toHaveLength(1);
    });

    it('does not duplicate an existing lane', () => {
        const lane = createTakeLane('t1');
        takeLaneStore.value = { lanes: [lane] } as never;
        addTakeLane('t1');
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });
});
