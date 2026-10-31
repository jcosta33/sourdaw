import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LoopStationState } from '../../../stores/loopStationStore';
import { triggerPad } from '../triggerPad';

const { getAllTracksMock, toggleRecordMock, triggerSlotMock } = vi.hoisted(() => ({
    getAllTracksMock: vi.fn<() => Array<{ id: string; name: string; kind?: string }>>(),
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

const loopStationStoreMock = vi.hoisted(() => ({
    value: null as import('../../../stores/loopStationStore').LoopStationState | null,
    set: vi.fn(),
}));

vi.mock('../../../stores/loopStationStore', () => ({
    loopStationStore: loopStationStoreMock,
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
        loopStationStoreMock.value = baseState();
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

    describe.each([
        ['master', { id: 'master', name: 'Master', kind: 'master' }],
        ['folder', { id: 'folder-1', name: 'Folder', kind: 'folder' }],
    ])('with a %s row before the first launchable track', (_label, leading) => {
        beforeEach(() => {
            getAllTracksMock.mockReturnValue([
                leading,
                { id: 't-alpha', name: 'Alpha', kind: 'audio' },
                { id: 't-beta', name: 'Beta', kind: 'midi' },
            ]);
            loopStationStoreMock.value = {
                ...baseState(),
                slots: [...baseState().slots, { ...baseState().slots[0]!, id: 's2', trackId: 't-beta', column: 1 }],
            };
        });

        it('resolves column 0 to the first launchable track for play', () => {
            triggerPad({ row: 1, column: 0, record: false });
            expect(triggerSlotMock).toHaveBeenCalledExactlyOnceWith('s1');
        });

        it('resolves column 0 to the same slot for record', () => {
            triggerPad({ row: 1, column: 0, record: true });
            expect(toggleRecordMock).toHaveBeenCalledExactlyOnceWith('s1');
        });

        it('resolves column 1 to the second launchable track', () => {
            triggerPad({ row: 1, column: 1, record: false });
            expect(triggerSlotMock).toHaveBeenCalledExactlyOnceWith('s2');
        });

        it('no-ops past the last launchable column', () => {
            triggerPad({ row: 1, column: 2, record: false });
            expect(triggerSlotMock).not.toHaveBeenCalled();
        });
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

    it('no-ops when no session is loaded', () => {
        loopStationStoreMock.value = null;

        triggerPad({ row: 1, column: 0, record: false });

        expect(triggerSlotMock).not.toHaveBeenCalled();
        expect(toggleRecordMock).not.toHaveBeenCalled();
    });
});
