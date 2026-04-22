import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LoopStationState } from '../../../stores/loopStationStore';
import { loopStationStore } from '../../../stores/loopStationStore';
import { toggleArm } from '../toggleArm';

vi.mock('../../../stores/loopStationStore', () => ({
    loopStationStore: {
        value: null,
        set: vi.fn<(state: import('../../../stores/loopStationStore').LoopStationState) => void>(),
    },
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
        loopStationStore.value = { ...emptyLoopState(), armed: false } as LoopStationState;

        toggleArm();

        expect(loopStationStore.set).toHaveBeenCalledWith(expect.objectContaining({ armed: true }));
    });
});
