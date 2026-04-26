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

vi.mock('#/modules/Command/stores', () => ({
    pushUndoEntry: pushUndoEntryMock,
}));

vi.mock('../../../stores/loopStationStore', () => ({
    loopStationStore: { value: null, set: vi.fn() },
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
        loopStationStore.value = emptyLoopState() as never;
        createSlot('track-1', 0, 0);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Create loop slot');
    });

    it('clearSlot pushes undo when the target slot exists', () => {
        loopStationStore.value = {
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
        } as never;
        clearSlot('s1');
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Clear loop slot');
    });

    it('clearSlot does not push undo when slot is missing', () => {
        loopStationStore.value = emptyLoopState() as never;
        clearSlot('missing');
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('setFixedLoopLength is a no-op (no undo) when the value is unchanged', () => {
        loopStationStore.value = { ...emptyLoopState(), fixedLoopLength: 8 } as never;
        setFixedLoopLength(8);
        expect(pushUndoEntryMock).not.toHaveBeenCalled();
    });

    it('setFixedLoopLength pushes undo when the value changes', () => {
        loopStationStore.value = { ...emptyLoopState(), fixedLoopLength: 4 } as never;
        setFixedLoopLength(8);
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Set loop length');
    });

    it('toggleArm pushes undo with a direction-specific label', () => {
        loopStationStore.value = emptyLoopState() as never;
        toggleArm();
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Arm loop station');
    });

    it('toggleSync pushes undo with a direction-specific label', () => {
        loopStationStore.value = { ...emptyLoopState(), syncToTransport: true } as never;
        toggleSync();
        expect(pushUndoEntryMock).toHaveBeenCalledTimes(1);
        expect(pushUndoEntryMock.mock.calls[0]![0]).toBe('Disable loop sync');
    });

    it('undo callback restores the previous fixedLoopLength', () => {
        loopStationStore.value = { ...emptyLoopState(), fixedLoopLength: 4 } as never;
        setFixedLoopLength(16);

        const [, undoFn] = pushUndoEntryMock.mock.calls[0]!;
        loopStationStore.value = { ...emptyLoopState(), fixedLoopLength: 16 } as never;
        (undoFn as () => void)();
        const restored = vi.mocked(loopStationStore.set).mock.lastCall?.[0] as LoopStationState | undefined;
        expect(restored?.fixedLoopLength).toBe(4);
    });
});
