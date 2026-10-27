import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { editPianoRollTakeNote, insertPianoRollTakeNote } from '../editPianoRollTakeNote';
import { projectPianoRollTakeNotes } from '../projectPianoRollTakeNotes';

const original = {
    id: 'original-row',
    pitch: 60,
    startBeat: 5.5,
    duration: 1,
    velocity: 90,
    pressure: 0,
    recordingPassIndex: 1,
};
const sibling = { id: 'sibling-row', pitch: 64, startBeat: 6.5, duration: 1, velocity: 80 };
const expressive = {
    id: 'expressive-row',
    pitch: 67,
    startBeat: 6,
    duration: 1,
    velocity: 91,
    pressure: 10,
    expression: { pressure: [{ offsetBeats: 0.5, value: 90 }] },
    recordingPassIndex: 1,
};
const source = {
    sourceClipId: 'source',
    sourceEntryBeat: 5,
    sourceEndBeat: 9,
    phaseHeadBeat: 0,
    passLengthBeats: 4,
    rows: {
        notes: { present: true as const, value: [original, sibling, expressive] },
        controlChanges: { present: true as const, value: [] },
        pitchBends: { present: true as const, value: [] },
    },
};
const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function rows() {
    return takeLaneStore.value?.lanes[0]?.takes.map((take) => take.midiSource?.rows.notes.value);
}

describe('selected piano roll Command callbacks', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('selected piano roll edit');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        setNotificationEventBus(
            createEventBus<{
                'ui.notify': NotifyPayload;
                'ui.confirm': ConfirmPayload;
                'ui.prompt': PromptPayload;
            }>()
        );
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane',
                    trackId: 'track',
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'selected' }],
                    takes: [
                        {
                            id: 'selected',
                            clipId: 'clip',
                            name: 'Selected',
                            selected: true,
                            startBeat: 0,
                            endBeat: 4,
                            recordingPassIndex: 1,
                            midiSource: structuredClone(source),
                        },
                        {
                            id: 'unselected',
                            clipId: 'other',
                            name: 'Unselected',
                            selected: false,
                            startBeat: 4,
                            endBeat: 8,
                            recordingPassIndex: 1,
                            midiSource: { ...structuredClone(source), phaseHeadBeat: 4 },
                        },
                    ],
                },
            ],
        });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        Container.clear();
        takeLaneStore.set({ lanes: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('edits the original property and inserts in the selected pass with Undo and Redo', async () => {
        const projection = projectPianoRollTakeNotes(
            { id: 'clip', startBeat: 0, endBeat: 4 },
            'track',
            takeLaneStore.value
        );
        const view = projection.notes.find((note) => projection.ownersByViewId.get(note.id)?.row.id === original.id);
        if (!view) {
            throw new Error('Expected selected note occurrence');
        }
        await editPianoRollTakeNote(projection, view.id, { pressure: 45 });
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id)?.pressure)).toEqual([
            45, 45,
        ]);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id)?.pressure)).toEqual([0, 0]);
        await redo();
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id)?.pressure)).toEqual([
            45, 45,
        ]);

        const addedId = await insertPianoRollTakeNote(projection, 1.5, {
            pitch: 67,
            duration: 0.5,
            velocity: 100,
            probability: 73,
            pressure: 31,
            expression: { pressure: [{ offsetBeats: 0.25, value: 90 }] },
            recordingPassIndex: 0,
        });
        expect(addedId).not.toBeNull();
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === addedId))).toEqual([
            expect.objectContaining({
                recordingPassIndex: 1,
                probability: 73,
                pressure: 31,
                expression: { pressure: [{ offsetBeats: 0.25, value: 90 }] },
            }),
            expect.objectContaining({
                recordingPassIndex: 1,
                probability: 73,
                pressure: 31,
                expression: { pressure: [{ offsetBeats: 0.25, value: 90 }] },
            }),
        ]);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rows()?.map((takeRows) => takeRows?.some((note) => note.id === addedId))).toEqual([false, false]);
    });

    it('re-cuts expressive source notes at their performed beats on either resize edge', async () => {
        const projection = projectPianoRollTakeNotes(
            { id: 'clip', startBeat: 0, endBeat: 4 },
            'track',
            takeLaneStore.value
        );
        const view = projection.notes.find((note) => projection.ownersByViewId.get(note.id)?.row.id === expressive.id);
        if (!view) {
            throw new Error('Expected expressive selected note');
        }

        await editPianoRollTakeNote(projection, view.id, { duration: 0.25 });
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === expressive.id))).toEqual([
            expect.objectContaining({ duration: 0.25, pressure: 10, recordingPassIndex: 1 }),
            expect.objectContaining({ duration: 0.25, pressure: 10, recordingPassIndex: 1 }),
        ]);
        expect(
            rows()?.every((takeRows) => takeRows?.find((note) => note.id === expressive.id)?.expression === undefined)
        ).toBe(true);
        expect(await undo()).toEqual({ headConsumed: true });

        await editPianoRollTakeNote(projection, view.id, {
            startBeat: view.startBeat + 0.5,
            duration: 0.5,
        });
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === expressive.id))).toEqual([
            expect.objectContaining({ startBeat: 6.5, duration: 0.5, pressure: 90, recordingPassIndex: 1 }),
            expect.objectContaining({ startBeat: 6.5, duration: 0.5, pressure: 90, recordingPassIndex: 1 }),
        ]);
        expect(
            rows()?.every((takeRows) => takeRows?.find((note) => note.id === expressive.id)?.expression === undefined)
        ).toBe(true);
        expect(await undo()).toEqual({ headConsumed: true });
        await redo();
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === expressive.id)?.pressure)).toEqual([
            90, 90,
        ]);
    });
});
