import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTakeLane } from '#/modules/Arrangement/models/TakeLane';
import { setCompRegion } from '../setCompRegion';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';

vi.mock('#/modules/Arrangement/stores/takeLaneStore', () => ({
    takeLaneStore: {
        value: null,
        set: vi.fn(),
    },
}));

describe('setCompRegion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no-ops when lane store is empty', () => {
        takeLaneStore.value = null as never;
        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'take-a' });
        expect(takeLaneStore.set).not.toHaveBeenCalled();
    });

    it('appends a comp region for the matching track lane', () => {
        const lane = createTakeLane('t1');
        takeLaneStore.value = { lanes: [lane] } as never;
        setCompRegion('t1', { startBeat: 0, endBeat: 4, takeId: 'take-a' });
        expect(takeLaneStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(takeLaneStore.set).mock.calls[0]![0] as { lanes: typeof lane[] };
        expect(next.lanes[0]!.activeCompRegions).toHaveLength(1);
        expect(next.lanes[0]!.activeCompRegions[0]).toEqual({ startBeat: 0, endBeat: 4, takeId: 'take-a' });
    });
});
