import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { toggleSync } from './toggleSync';

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

describe('toggleSync', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('flips syncToTransport', () => {
        const set = vi.fn();
        injectDependencies(toggleSync, {
            loopStationStore: {
                value: { ...emptyLoopState(), syncToTransport: true },
                set,
            } as never,
        });
        toggleSync();
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ syncToTransport: false }));
    });
});
