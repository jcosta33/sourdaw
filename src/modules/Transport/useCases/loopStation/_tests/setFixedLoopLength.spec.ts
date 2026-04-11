import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { setFixedLoopLength } from '../setFixedLoopLength';
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

describe('setFixedLoopLength', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes fixedLoopLength', () => {
        loopStationStore.value = emptyLoopState() as any;
        
        setFixedLoopLength(8);
        
        expect(loopStationStore.set).toHaveBeenCalledWith(expect.objectContaining({ fixedLoopLength: 8 }));
    });
});
