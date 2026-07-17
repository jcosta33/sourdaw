import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LoopStationState } from '../../../stores/loopStationStore';
import { loopStationStore } from '../../../stores/loopStationStore';
import { undoLastLayer } from '../undoLastLayer';

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

describe('undoLastLayer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('drops last layer and clears slot when no layers remain', () => {
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
                    layers: [
                        {
                            id: 'L1',
                            layerIndex: 0,
                            recordedAt: '',
                            muted: false,
                            volume: 1,
                        },
                    ],
                    loopCount: 0,
                    volume: 1,
                    quantize: true,
                    fadeBeats: 0.125,
                },
            ],
        } as LoopStationState;

        undoLastLayer('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.layers).toHaveLength(0);
        expect(next.slots[0]!.state).toBe('empty');
    });
});
