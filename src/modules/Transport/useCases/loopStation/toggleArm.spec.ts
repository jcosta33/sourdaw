import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { toggleArm } from './toggleArm';

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

describe('toggleArm', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('flips armed via injected store', () => {
        const set = vi.fn();
        injectDependencies(toggleArm, {
            loopStationStore: {
                value: { ...emptyLoopState(), armed: false },
                set,
            } as never,
        });
        toggleArm();
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ armed: true }));
    });
});
