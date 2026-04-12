import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { toggleArm } from '../toggleArm';
import { loopStationStore } from '#/modules/Transport/stores/loopStationStore';

vi.mock('#/modules/Transport/stores/loopStationStore', () => ({
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

describe('toggleArm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('flips armed via injected store', () => {
        loopStationStore.value = { ...emptyLoopState(), armed: false } as any;
        
        toggleArm();
        
        expect(loopStationStore.set).toHaveBeenCalledWith(expect.objectContaining({ armed: true }));
    });
});
