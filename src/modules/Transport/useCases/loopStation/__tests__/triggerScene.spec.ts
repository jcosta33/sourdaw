import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { triggerScene } from '../triggerScene';
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

describe('triggerScene', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sets activeScene', () => {
        loopStationStore.value = emptyLoopState() as any;
        
        triggerScene(3);
        
        expect(loopStationStore.set).toHaveBeenCalledWith(expect.objectContaining({ activeScene: 3 }));
    });
});
