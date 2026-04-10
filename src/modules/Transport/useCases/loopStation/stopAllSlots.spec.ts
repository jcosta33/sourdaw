import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { stopAllSlots } from './stopAllSlots';

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
        Container.clear();
    });

    it('stops playing slots', () => {
        const set = vi.fn();
        injectDependencies(stopAllSlots, {
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
        stopAllSlots();
        const next = set.mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('stopped');
    });
});
