import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState, takeLaneStore } from '../../../stores/takeLaneStore';
import { addTakeLane } from '../addTakeLane';

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

describe('addTakeLane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no-ops when store is empty', () => {
        mocks.takeLaneStoreValue.value = null;
        addTakeLane('t1');
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('adds a lane when missing', () => {
        mocks.takeLaneStoreValue.value = { lanes: [] };
        addTakeLane('t1');
        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: unknown[] };
        expect(next.lanes).toHaveLength(1);
    });

    it('does not duplicate an existing lane', () => {
        const lane = createTakeLane('t1');
        mocks.takeLaneStoreValue.value = { lanes: [lane] };
        addTakeLane('t1');
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });
});
