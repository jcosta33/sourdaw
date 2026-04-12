import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type LoopStationState } from '../../../stores/loopStationStore';
import { toggleRecord } from '../toggleRecord';
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

describe('toggleRecord', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('advances empty slot to recording', () => {
        loopStationStore.value = {
            ...emptyLoopState(),
            slots: [
                {
                    id: 's1',
                    trackId: 't',
                    row: 0,
                    column: 0,
                    state: 'empty',
                    lengthBeats: 0,
                    layers: [],
                    loopCount: 0,
                    volume: 1,
                    quantize: true,
                    fadeBeats: 0.125,
                },
            ],
        } as any;
        
        toggleRecord('s1');
        
        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('recording');
    });
});
