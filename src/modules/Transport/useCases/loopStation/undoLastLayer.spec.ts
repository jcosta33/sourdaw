import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { undoLastLayer } from './undoLastLayer';

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
        Container.clear();
    });

    it('drops last layer and clears slot when no layers remain', () => {
        const set = vi.fn();
        injectDependencies(undoLastLayer, {
            loopStationStore: {
                value: {
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
                },
                set,
            } as never,
        });
        undoLastLayer('s1');
        const next = set.mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.layers).toHaveLength(0);
        expect(next.slots[0]!.state).toBe('empty');
    });
});
