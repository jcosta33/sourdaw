import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type LoopStationState } from '../../../stores/loopStationStore';
import { stopAllSlots } from '../stopAllSlots';
import { loopStationStore } from '../../../stores/loopStationStore';

vi.mock('../../../stores/loopStationStore', () => ({
    loopStationStore: { value: null, set: vi.fn() },
}));

function emptyLoopState(): LoopStationState {
    return {
        slots: [],
        sceneCount: 8,
        activeScene: 0,
        armed: false,
        syncToTransport: true,
        fixedLoopLength: 0,
    };
}

describe('stopAllSlots', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('stops playing slots', () => {
        loopStationStore.value = {
            ...emptyLoopState(),
            slots: [
                {
                    id: 's1',
                    trackId: 't',
                    row: 0,
                    column: 0,
                    state: 'playing',
                    lengthBeats: 4,
                    layers: [],
                    loopCount: 0,
                    volume: 1,
                    quantize: true,
                    fadeBeats: 0.125,
                },
            ],
        } as any;
        
        stopAllSlots();
        
        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('stopped');
    });
});
