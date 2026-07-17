import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LoopStationState } from '../../../stores/loopStationStore';
import { loopStationStore } from '../../../stores/loopStationStore';
import { triggerScene } from '../triggerScene';

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

describe('triggerScene', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sets activeScene', () => {
        loopStationStoreMock.value = emptyLoopState();

        triggerScene(3);

        expect(loopStationStore.set).toHaveBeenCalledWith(expect.objectContaining({ activeScene: 3 }));
    });
});
