import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LoopStationState } from '../../../stores/loopStationStore';
import { loopStationStore } from '../../../stores/loopStationStore';
import { setFixedLoopLength } from '../setFixedLoopLength';

const loopStationStoreMock = vi.hoisted(() => ({
    value: null as import('../../../stores/loopStationStore').LoopStationState | null,
    set: vi.fn(),
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

describe('setFixedLoopLength', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes fixedLoopLength', () => {
        loopStationStoreMock.value = emptyLoopState();

        setFixedLoopLength(8);

        expect(loopStationStore.set).toHaveBeenCalledWith(expect.objectContaining({ fixedLoopLength: 8 }));
    });
});
