import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LoopStationState } from '../../../stores/loopStationStore';
import { loopStationStore } from '../../../stores/loopStationStore';
import { stopSlot } from '../stopSlot';

const loopStationStoreMock = vi.hoisted(() => ({
    value: null as import('../../../stores/loopStationStore').LoopStationState | null,
    set: vi.fn<(state: import('../../../stores/loopStationStore').LoopStationState) => void>(),
}));

vi.mock('../../../stores/loopStationStore', () => ({
    loopStationStore: loopStationStoreMock,
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

describe('stopSlot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('marks matching slot stopped', () => {
        loopStationStoreMock.value = {
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
        };

        stopSlot('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('stopped');
    });
});
