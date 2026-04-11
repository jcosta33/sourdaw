import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { createSlot } from '../createSlot';
import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

vi.mock('#/modules/Transport/stores/loopStationStore', () => ({
    loopStationStore: { value: null, set: vi.fn() },
}));

describe('createSlot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('appends a slot when store state exists', () => {
        const baseState: LoopStationState = {
            slots: [],
            sceneCount: 8,
            activeScene: 0,
            armed: false,
            syncToTransport: true,
            fixedLoopLength: 0,
        };
        
        loopStationStore.value = baseState as any;

        createSlot('track-1', 0, 0);

        expect(loopStationStore.set).toHaveBeenCalledTimes(1);
        const nextState = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(nextState.slots).toHaveLength(1);
        expect(nextState.slots[0]!.trackId).toBe('track-1');
    });
});
