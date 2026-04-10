import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { setFixedLoopLength } from './setFixedLoopLength';

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

describe('setFixedLoopLength', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('writes fixedLoopLength', () => {
        const set = vi.fn();
        injectDependencies(setFixedLoopLength, {
            loopStationStore: {
                value: emptyLoopState(),
                set,
            } as never,
        });
        setFixedLoopLength(8);
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ fixedLoopLength: 8 }));
    });
});
