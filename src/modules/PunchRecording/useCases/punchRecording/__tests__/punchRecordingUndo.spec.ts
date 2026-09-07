import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type PunchRecordingState } from '../../../stores/punchRecordingStore';
import { commitPunchRegion } from '../commitPunchRegion';
import { definePunchRegion } from '../definePunchRegion';
import { discardCapture } from '../discardCapture';
import { setPostRoll } from '../setPostRoll';
import { setPreRoll } from '../setPreRoll';
import { togglePunchRecording } from '../togglePunchRecording';

const { pushUndoEntryMock } = vi.hoisted(() => ({
    pushUndoEntryMock: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: pushUndoEntryMock,
}));

const mockPunchRecordingStore = vi.hoisted(() => ({
    value: null as PunchRecordingState | null,
    set: vi.fn(),
}));

vi.mock('../../../stores/punchRecordingStore', () => ({
    punchRecordingStore: mockPunchRecordingStore,
}));

vi.mock('../../../repositories/punchRecordingIdCounter/getNextPunchId', () => ({
    getNextPunchId: () => 'punch-new',
}));

function baseState(overrides: Partial<PunchRecordingState> = {}): PunchRecordingState {
    return {
        captures: [],
        defaultPreRoll: 4,
        defaultPostRoll: 2,
        defaultCrossfade: 0.25,
        enabled: false,
        ...overrides,
    };
}

describe('punch recording undo entries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPunchRecordingStore.value = null;
    });

    it('setPreRoll skips undo when unchanged and pushes it when different', () => {
        mockPunchRecordingStore.value = baseState({ defaultPreRoll: 4 });
        setPreRoll(4);
        expect(pushUndoEntryMock).not.toHaveBeenCalled();

        setPreRoll(8);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Set punch pre-roll');
    });

    it('setPostRoll pushes undo only on change', () => {
        mockPunchRecordingStore.value = baseState({ defaultPostRoll: 2 });
        setPostRoll(4);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Set punch post-roll');
    });

    it('togglePunchRecording labels reflect the direction', () => {
        mockPunchRecordingStore.value = baseState({ enabled: false });
        togglePunchRecording();
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Enable punch recording');

        pushUndoEntryMock.mockClear();
        mockPunchRecordingStore.value = baseState({ enabled: true });
        togglePunchRecording();
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Disable punch recording');
    });

    it('definePunchRegion pushes undo when the capture exists', () => {
        mockPunchRecordingStore.value = baseState({
            captures: [
                {
                    id: 'cap',
                    trackId: 't',
                    startBeat: 0,
                    endBeat: 8,
                    recording: false,
                    punchRegions: [],
                },
            ],
        });
        definePunchRegion('cap', 1, 3);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Define punch region');
    });

    it('commitPunchRegion no-ops (no undo) when already committed', () => {
        mockPunchRecordingStore.value = baseState({
            captures: [
                {
                    id: 'cap',
                    trackId: 't',
                    startBeat: 0,
                    endBeat: 8,
                    recording: false,
                    punchRegions: [
                        {
                            id: 'r1',
                            trackId: 't',
                            punchInBeat: 1,
                            punchOutBeat: 3,
                            sourceClipId: 'cap',
                            preRollBeats: 4,
                            postRollBeats: 2,
                            committed: true,
                            crossfadeBeats: 0.25,
                        },
                    ],
                },
            ],
        });
        commitPunchRegion('cap', 'r1');
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('discardCapture pushes undo only for an existing capture', () => {
        mockPunchRecordingStore.value = baseState();
        discardCapture('missing');
        expect(pushUndoEntryMock).not.toHaveBeenCalled();

        mockPunchRecordingStore.value = baseState({
            captures: [
                {
                    id: 'cap',
                    trackId: 't',
                    startBeat: 0,
                    endBeat: 8,
                    recording: false,
                    punchRegions: [],
                },
            ],
        });
        discardCapture('cap');
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Discard capture');
    });

    it('discardCapture undo restores the capture', () => {
        const captures = [
            {
                id: 'cap',
                trackId: 't',
                startBeat: 0,
                endBeat: 8,
                recording: false,
                punchRegions: [],
            },
        ];
        const initial = baseState({ captures });
        mockPunchRecordingStore.value = initial;
        discardCapture('cap');
        const [, undoFn] = pushUndoEntryMock.mock.calls[0]!;
        (undoFn as () => void)();
        expect(mockPunchRecordingStore.set).toHaveBeenLastCalledWith(initial);
    });
});
