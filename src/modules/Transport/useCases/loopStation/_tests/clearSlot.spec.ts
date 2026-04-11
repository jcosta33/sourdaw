import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type LoopSlot, type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { clearSlot } from '../clearSlot';
import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

vi.mock('#/modules/Transport/stores/loopStationStore', () => ({
    loopStationStore: { value: null, set: vi.fn() },
}));

describe('clearSlot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clears layers on the matching slot id', () => {
        const slot: LoopSlot = {
            id: 'slot-a',
            trackId: 't1',
            row: 0,
            column: 0,
            state: 'playing',
            lengthBeats: 4,
            layers: [{ id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
            loopCount: 1,
            volume: 1,
            quantize: true,
            fadeBeats: 0.125,
        };
        const baseState: LoopStationState = {
            slots: [slot],
            sceneCount: 8,
            activeScene: 0,
            armed: false,
            syncToTransport: true,
            fixedLoopLength: 0,
        };
        
        loopStationStore.value = baseState as any;

        clearSlot('slot-a');

        expect(loopStationStore.set).toHaveBeenCalledTimes(1);
        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('empty');
        expect(next.slots[0]!.layers).toHaveLength(0);
    });
});
