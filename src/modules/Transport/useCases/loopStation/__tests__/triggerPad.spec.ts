import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loopStationStore, type LoopStationState } from '../../../stores/loopStationStore';
import { triggerPad } from '../triggerPad';

const { getAllTracksMock, toggleRecordMock, triggerSlotMock } = vi.hoisted(() => ({
    getAllTracksMock: vi.fn<() => Array<{ id: string; name: string }>>(),
    toggleRecordMock: vi.fn<(slotId: string) => void>(),
    triggerSlotMock: vi.fn<(slotId: string) => void>(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: getAllTracksMock,
}));

vi.mock('../toggleRecord', () => ({
    toggleRecord: toggleRecordMock,
}));

vi.mock('../triggerSlot', () => ({
    triggerSlot: triggerSlotMock,
}));

vi.mock('../../../stores/loopStationStore', () => ({
    loopStationStore: { value: null, set: vi.fn() },
}));

function baseState(): LoopStationState {
    return {
        slots: [
            {
                id: 's1',
                trackId: 't-alpha',
                row: 1,
                column: 0,
                state: 'empty',
                lengthBeats: 0,
                layers: [],
                loopCount: 0,
                volume: 1,
                quantize: true,
                fadeBeats: 0,
            },
        ],
        sceneCount: 8,
        activeScene: 0,
        armed: false,
        syncToTransport: true,
        fixedLoopLength: 0,
    };
}

describe('triggerPad', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAllTracksMock.mockReturnValue([{ id: 't-alpha', name: 'Alpha' }]);
        loopStationStore.value = baseState() as never;
    });

    it('routes plain press to triggerSlot', () => {
        triggerPad({ row: 1, column: 0, record: false });
        expect(triggerSlotMock).toHaveBeenCalledWith('s1');
        expect(toggleRecordMock).not.toHaveBeenCalled();
    });

    it('routes shift press to toggleRecord', () => {
        triggerPad({ row: 1, column: 0, record: true });
        expect(toggleRecordMock).toHaveBeenCalledWith('s1');
        expect(triggerSlotMock).not.toHaveBeenCalled();
    });

    it('no-ops when the column exceeds the track count', () => {
        triggerPad({ row: 1, column: 4, record: false });
        expect(triggerSlotMock).not.toHaveBeenCalled();
        expect(toggleRecordMock).not.toHaveBeenCalled();
    });

    it('no-ops when no slot exists at the coordinate', () => {
        triggerPad({ row: 3, column: 0, record: false });
        expect(triggerSlotMock).not.toHaveBeenCalled();
    });
});
