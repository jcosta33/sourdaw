import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { triggerScene } from './triggerScene';

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

describe('triggerScene', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('sets activeScene', () => {
        const set = vi.fn();
        injectDependencies(triggerScene, {
            loopStationStore: {
                value: emptyLoopState(),
                set,
            } as never,
        });
        triggerScene(3);
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ activeScene: 3 }));
    });
});
