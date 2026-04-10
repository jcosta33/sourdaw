import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { toggleRecord } from './toggleRecord';

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
        Container.clear();
    });

    it('advances empty slot to recording', () => {
        const set = vi.fn();
        injectDependencies(toggleRecord, {
            loopStationStore: {
                value: {
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
                },
                set,
            } as never,
        });
        toggleRecord('s1');
        const next = set.mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('recording');
    });
});
