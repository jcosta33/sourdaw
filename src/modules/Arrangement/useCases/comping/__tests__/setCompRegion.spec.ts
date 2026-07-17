import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createTakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState, takeLaneStore } from '../../../stores/takeLaneStore';
import { setCompRegion } from '../setCompRegion';

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

describe('setCompRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no-ops when lane store is empty', () => {
        mocks.takeLaneStoreValue.value = null;
        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'take-a' });
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('appends a comp region for the matching track lane', () => {
        const lane = createTakeLane('t1');
        mocks.takeLaneStoreValue.value = { lanes: [lane] };
        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'take-a' });
        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: (typeof lane)[] };
        expect(next.lanes[0]!.activeCompRegions).toHaveLength(1);
        expect(next.lanes[0]!.activeCompRegions[0]).toEqual({ startBeat: 0, endBeat: 4, takeId: 'take-a' });
    });
});
