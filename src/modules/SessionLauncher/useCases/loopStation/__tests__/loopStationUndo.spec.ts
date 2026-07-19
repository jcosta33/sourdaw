import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loopStationStore, type LoopStationState } from '../../../stores/loopStationStore';
import { clearSlot } from '../clearSlot';
import { createSlot } from '../createSlot';
import { setFixedLoopLength } from '../setFixedLoopLength';
import { toggleArm } from '../toggleArm';
import { toggleSync } from '../toggleSync';

const { pushUndoEntryMock } = vi.hoisted(() => ({
    pushUndoEntryMock: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: pushUndoEntryMock,
    runLegacyCommandMutation: (mutation: (commitUndo: typeof pushUndoEntryMock) => unknown) =>
        Promise.resolve(mutation(pushUndoEntryMock)),
}));

const loopStationStoreMock = vi.hoisted(() => ({
    value: null as import('../../../stores/loopStationStore').LoopStationState | null,
    set: vi.fn(),
}));

vi.mock('../../../stores/loopStationStore', () => ({
    loopStationStore: loopStationStoreMock,
}));

vi.mock('../../../repositories/loopStationIdCounter/getNextSlotId', () => ({
    getNextSlotId: () => 'slot-new',
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

describe('loop station undo entries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('createSlot pushes an undo entry whose undo restores the prior slot list', () => {
        loopStationStoreMock.value = emptyLoopState();
        createSlot('track-1', 0, 0);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Create loop slot');
    });

    it('clearSlot pushes undo when the target slot exists', () => {
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [
                {
                    id: 's1',
                    trackId: 't',
                    row: 0,
                    column: 0,
                    state: 'playing',
                    lengthBeats: 4,
                    layers: [],
                    loopCount: 0,
                    volume: 1,
                    quantize: true,
                    fadeBeats: 0,
                },
            ],
        };
        clearSlot('s1');
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Clear loop slot');
    });

    it('clearSlot does not push undo when slot is missing', () => {
        loopStationStoreMock.value = emptyLoopState();
        clearSlot('missing');
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('setFixedLoopLength is a no-op (no undo) when the value is unchanged', () => {
        loopStationStoreMock.value = { ...emptyLoopState(), fixedLoopLength: 8 };
        setFixedLoopLength(8);
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('setFixedLoopLength pushes undo when the value changes', () => {
        loopStationStoreMock.value = { ...emptyLoopState(), fixedLoopLength: 4 };
        setFixedLoopLength(8);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Set loop length');
    });

    it('toggleArm pushes undo with a direction-specific label', () => {
        loopStationStoreMock.value = emptyLoopState();
        toggleArm();
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Arm loop station');
    });

    it('toggleSync pushes undo with a direction-specific label', () => {
        loopStationStoreMock.value = { ...emptyLoopState(), syncToTransport: true };
        toggleSync();
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Disable loop sync');
    });

    it('undo callback restores the previous fixedLoopLength', () => {
        loopStationStoreMock.value = { ...emptyLoopState(), fixedLoopLength: 4 };
        setFixedLoopLength(16);

        const [, undoFn] = pushUndoEntryMock.mock.calls[0]!;
        loopStationStoreMock.value = { ...emptyLoopState(), fixedLoopLength: 16 };
        (undoFn as () => void)();
        const restored = vi.mocked(loopStationStore.set).mock.lastCall?.[0] as LoopStationState | undefined;
        expect(restored?.fixedLoopLength).toBe(4);
    });
});
