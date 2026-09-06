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
    executeUserAppAction: vi.fn(),
    pushUndoEntry: pushUndoEntryMock,
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

    it('createSlot does not push undo when no session is loaded', () => {
        loopStationStoreMock.value = null;
        createSlot('track-1', 0, 0);
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('createSlot undo restores the prior slot list and redo re-applies the created slot', () => {
        loopStationStoreMock.value = emptyLoopState();
        createSlot('track-1', 0, 0);

        const [, undoFn, redoFn] = pushUndoEntryMock.mock.calls[0]!;

        loopStationStoreMock.value = emptyLoopState();
        (undoFn as () => void)();
        const clearedSlots = vi.mocked(loopStationStore.set).mock.lastCall?.[0] as LoopStationState;
        expect(clearedSlots.slots).toHaveLength(0);

        loopStationStoreMock.value = emptyLoopState();
        (redoFn as () => void)();
        const redone = vi.mocked(loopStationStore.set).mock.lastCall?.[0] as LoopStationState;
        expect(redone.slots).toHaveLength(1);
        expect(redone.slots[0]!.trackId).toBe('track-1');
    });

    it('clearSlot undo restores the previous slot and redo re-clears it', () => {
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
                    layers: [{ id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
                    loopCount: 2,
                    volume: 1,
                    quantize: true,
                    fadeBeats: 0,
                },
            ],
        };
        clearSlot('s1');

        const [, undoFn, redoFn] = pushUndoEntryMock.mock.calls[0]!;

        loopStationStoreMock.value = emptyLoopState();
        (undoFn as () => void)();
        const restored = vi.mocked(loopStationStore.set).mock.lastCall?.[0] as LoopStationState;
        expect(restored.slots[0]!.state).toBe('playing');
        expect(restored.slots[0]!.layers).toHaveLength(1);

        loopStationStoreMock.value = emptyLoopState();
        (redoFn as () => void)();
        const cleared = vi.mocked(loopStationStore.set).mock.lastCall?.[0] as LoopStationState;
        expect(cleared.slots[0]!.state).toBe('empty');
    });

    it('toggleArm does not push undo when no session is loaded', () => {
        loopStationStoreMock.value = null;
        toggleArm();
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('toggleArm uses a disarm label, and its undo/redo callbacks restore each direction', () => {
        loopStationStoreMock.value = { ...emptyLoopState(), armed: true };
        toggleArm();
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Disarm loop station');

        const [, undoFn, redoFn] = pushUndoEntryMock.mock.calls[0]!;

        loopStationStoreMock.value = emptyLoopState();
        (undoFn as () => void)();
        const afterUndo = vi.mocked(loopStationStore.set).mock.lastCall?.[0] as LoopStationState;
        expect(afterUndo.armed).toBe(true);

        loopStationStoreMock.value = emptyLoopState();
        (redoFn as () => void)();
        const afterRedo = vi.mocked(loopStationStore.set).mock.lastCall?.[0] as LoopStationState;
        expect(afterRedo.armed).toBe(false);
    });

    it('toggleSync uses an enable label, and its undo/redo callbacks restore each direction', () => {
        loopStationStoreMock.value = { ...emptyLoopState(), syncToTransport: false };
        toggleSync();
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Enable loop sync');

        const [, undoFn, redoFn] = pushUndoEntryMock.mock.calls[0]!;

        loopStationStoreMock.value = emptyLoopState();
        (undoFn as () => void)();
        const afterUndo = vi.mocked(loopStationStore.set).mock.lastCall?.[0] as LoopStationState;
        expect(afterUndo.syncToTransport).toBe(false);

        loopStationStoreMock.value = emptyLoopState();
        (redoFn as () => void)();
        const afterRedo = vi.mocked(loopStationStore.set).mock.lastCall?.[0] as LoopStationState;
        expect(afterRedo.syncToTransport).toBe(true);
    });

    it('setFixedLoopLength does not push undo when no session is loaded', () => {
        loopStationStoreMock.value = null;
        setFixedLoopLength(8);
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('redo callback re-applies the new fixedLoopLength', () => {
        loopStationStoreMock.value = { ...emptyLoopState(), fixedLoopLength: 4 };
        setFixedLoopLength(16);

        const [, , redoFn] = pushUndoEntryMock.mock.calls[0]!;
        loopStationStoreMock.value = { ...emptyLoopState(), fixedLoopLength: 4 };
        (redoFn as () => void)();
        const restored = vi.mocked(loopStationStore.set).mock.lastCall?.[0] as LoopStationState;
        expect(restored.fixedLoopLength).toBe(16);
    });

    it('clearSlot does not push undo when no session is loaded', () => {
        loopStationStoreMock.value = null;
        clearSlot('s1');
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });
});
