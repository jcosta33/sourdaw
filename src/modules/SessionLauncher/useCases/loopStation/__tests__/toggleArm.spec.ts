import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LoopStationState } from '../../../stores/loopStationStore';
import { loopStationStore } from '../../../stores/loopStationStore';
import { toggleArm } from '../toggleArm';

const loopStationStoreMock = vi.hoisted(() => ({
    value: null as import('../../../stores/loopStationStore').LoopStationState | null,
    set: vi.fn<(state: import('../../../stores/loopStationStore').LoopStationState) => void>(),
}));

vi.mock('../../../stores/loopStationStore', () => ({
    loopStationStore: loopStationStoreMock,
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
        loopStationStoreMock.value = { ...emptyLoopState(), armed: false };

        toggleArm();

        expect(loopStationStore.set).toHaveBeenCalledWith(expect.objectContaining({ armed: true }));
    });
});
