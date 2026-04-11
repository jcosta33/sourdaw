import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { toggleSync } from '../toggleSync';
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

describe('toggleSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('flips syncToTransport', () => {
        loopStationStore.value = { ...emptyLoopState(), syncToTransport: true } as any;
        
        toggleSync();
        
        expect(loopStationStore.set).toHaveBeenCalledWith(expect.objectContaining({ syncToTransport: false }));
    });
});
