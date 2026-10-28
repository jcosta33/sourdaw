import { createElement, useRef } from 'react';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, takeLaneStore } from '#/modules/Arrangement/stores';
import {
    addClip,
    copyPianoRollNotes,
    createTrack,
    getArrangementHandlers,
    getCopiedPianoRollNotes,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
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
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { usePianoRollInteractions } from '../../hooks/usePianoRollInteractions';
import { PianoRollContextMenu } from '../../views/ClipView/PianoRollContextMenu';
import {
    cutPianoRollTakeNotes,
    pastePianoRollTakeNotes,
    transformPianoRollTakeNotes,
} from '../applyPianoRollTakeMenuAction';
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

function mixedProjection() {
    const lane = takeLaneStore.value?.lanes[0];
    if (!lane) {
        throw new Error('Expected take lane');
    }
    const secondRow = {
        id: 'second-pass-row',
        pitch: 70,
        startBeat: 9.4,
        duration: 1,
        velocity: 84,
        recordingPassIndex: 0,
    };
    const secondSource = {
        ...structuredClone(source),
        sourceClipId: 'second-source',
        sourceEntryBeat: 9,
        sourceEndBeat: 13,
        phaseHeadBeat: 8,
        rows: { ...structuredClone(source.rows), notes: { present: true as const, value: [secondRow] } },
    };
    takeLaneStore.set({
        lanes: [
            {
                ...lane,
                activeCompRegions: [
                    { startBeat: 0, endBeat: 8, takeId: 'selected' },
                    { startBeat: 8, endBeat: 12, takeId: 'second' },
                ],
                takes: [
                    { ...lane.takes[0]!, endBeat: 8 },
                    lane.takes[1]!,
                    {
                        id: 'second',
                        clipId: 'clip',
                        name: 'Second',
                        selected: true,
                        startBeat: 8,
                        endBeat: 12,
                        recordingPassIndex: 0,
                        midiSource: structuredClone(secondSource),
                    },
                    {
                        id: 'second-unselected',
                        clipId: 'other',
                        name: 'Second copy',
                        selected: false,
                        startBeat: 12,
                        endBeat: 16,
                        recordingPassIndex: 0,
                        midiSource: structuredClone(secondSource),
                    },
                ],
            },
        ],
    });
    return projectPianoRollTakeNotes({ id: 'clip', startBeat: 0, endBeat: 12 }, 'track', takeLaneStore.value);
}

const baseGapRow = { id: 'base-gap-original', pitch: 62, startBeat: 4.5, duration: 0.5, velocity: 87 };

function mixedGapProjection() {
    mixedProjection();
    const lane = takeLaneStore.value?.lanes[0];
    if (!lane) {
        throw new Error('Expected take lane');
    }
    takeLaneStore.set({
        lanes: [
            {
                ...lane,
                activeCompRegions: [
                    { startBeat: 0, endBeat: 4, takeId: 'selected' },
                    { startBeat: 8, endBeat: 12, takeId: 'second' },
                ],
            },
        ],
    });
    setTrackStoreState({ ...defaultTrackState, tracks: [createTrack({ id: 'track', kind: 'midi', name: 'MIDI' })] });
    if (addClip({ id: 'clip', trackId: 'track', startBeat: 0, endBeat: 12, name: 'Clip', type: 'midi' }) === null) {
        throw new Error('Expected MIDI clip');
    }
    midiStore.set({ notesByClipId: { clip: [baseGapRow] }, ccByClipId: {}, pitchBendByClipId: {} });
    registerHandlerMap(getMidiNoteTransformHandlers());
    return projectPianoRollTakeNotes(
        { id: 'clip', startBeat: 0, endBeat: 12 },
        'track',
        takeLaneStore.value,
        midiStore.value?.notesByClipId.clip
    );
}

function renderTakeMenu(
    projection: ReturnType<typeof projectPianoRollTakeNotes>,
    selectedNoteIds: Set<string>,
    beat: number
) {
    render(
        createElement(PianoRollContextMenu, {
            menu: { x: 100, y: 100, beat, pitch: 60 },
            clipId: 'clip',
            notes: [...projection.baseNotes, ...projection.notes],
            selectedNoteIds,
            takeProjection: projection,
            onClose: () => undefined,
            onSelectAll: () => undefined,
            onClearSelection: () => undefined,
        })
    );
}

function SelectedNoteEditor({
    projection,
    viewId,
    stepInput = false,
}: {
    projection: ReturnType<typeof projectPianoRollTakeNotes>;
    viewId?: string;
    stepInput?: boolean;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const handlers = usePianoRollInteractions({
        canvasRef,
        scrollRef: { current: null },
        clipId: 'clip',
        trackId: 'track',
        notes: projection.notes,
        takeProjections: new Map([['clip', projection]]),
        beatWidth: 40,
        gridSnap: 0.5,
        scaleType: 'chromatic',
        scaleRoot: 0,
        isFolded: false,
        stepInput,
        stepBeat: 3,
        setStepBeat: () => undefined,
        chordMode: false,
        chordType: 'major',
        paintMode: false,
        lassoMode: false,
        selectedNoteIds: viewId ? new Set([viewId]) : new Set(),
        setSelectedNoteIds: () => undefined,
        setZoom: () => undefined,
        draw: () => undefined,
        constrainToScale: false,
        notePreviewEnabled: false,
        drawPreviewRef: { current: null },
        rubberBandRef: { current: null },
        dragPreviewRef: { current: null },
    });
    return (
        <canvas
            aria-label="selected-note-editor"
            ref={canvasRef}
            onKeyDown={handlers.handleKeyDown}
            onMouseDown={handlers.handleMouseDown}
            onMouseMove={handlers.handleMouseMove}
            onMouseUp={handlers.handleMouseUp}
        />
    );
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
        cleanup();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        Container.clear();
        takeLaneStore.set({ lanes: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('cuts and pastes a cropped selected bend note through its original row and Undo', async () => {
        const lane = takeLaneStore.value?.lanes[0];
        if (!lane) {
            throw new Error('Expected take lane');
        }
        takeLaneStore.set({
            lanes: [
                {
                    ...lane,
                    activeCompRegions: [{ startBeat: 1, endBeat: 4, takeId: 'selected' }],
                    takes: lane.takes.map((take) => {
                        const midiSource = take.midiSource;
                        if (!midiSource) {
                            return take;
                        }
                        return {
                            ...take,
                            midiSource: {
                                ...midiSource,
                                rows: {
                                    ...midiSource.rows,
                                    notes: {
                                        present: true,
                                        value: midiSource.rows.notes.value.map((note) =>
                                            note.id === original.id ? { ...note, pitchBend: 1000 } : note
                                        ),
                                    },
                                },
                            },
                        };
                    }),
                },
            ],
        });
        flushAutomergeStorageWrites();
        const placement = { id: 'clip', startBeat: 0, endBeat: 4 };
        const projection = projectPianoRollTakeNotes(placement, 'track', takeLaneStore.value);
        const selected = projection.notes.find(
            (note) => projection.ownersByViewId.get(note.id)?.row.id === original.id
        );
        if (!selected) {
            throw new Error('Expected cropped selected note');
        }

        expect(await cutPianoRollTakeNotes(projection, 'clip', new Set([selected.id]))).toBe(true);
        expect(rows()?.every((takeRows) => !takeRows?.some((note) => note.id === original.id))).toBe(true);
        expect(getCopiedPianoRollNotes()).toEqual([selected]);
        await undo();
        expect(rows()?.every((takeRows) => takeRows?.some((note) => note.id === original.id))).toBe(true);
        await redo();
        expect(rows()?.every((takeRows) => !takeRows?.some((note) => note.id === original.id))).toBe(true);

        const afterCut = projectPianoRollTakeNotes(placement, 'track', takeLaneStore.value);
        expect(await pastePianoRollTakeNotes(afterCut, 'clip', 1.5)).toBe(true);
        expect(rows()?.[0]?.some((note) => note.pitchBend === 1000 && note.id !== original.id)).toBe(true);
        await undo();
        expect(rows()?.[0]?.some((note) => note.pitchBend === 1000 && note.id !== original.id)).toBe(false);
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

    it('routes a selected keyboard nudge through Command and keeps both frozen copies undoable', async () => {
        const projection = projectPianoRollTakeNotes(
            { id: 'clip', startBeat: 0, endBeat: 4 },
            'track',
            takeLaneStore.value
        );
        const view = projection.notes.find((note) => projection.ownersByViewId.get(note.id)?.row.id === original.id);
        if (!view) {
            throw new Error('Expected selected note occurrence');
        }
        render(createElement(SelectedNoteEditor, { projection, viewId: view.id }));
        fireEvent.keyDown(screen.getByLabelText('selected-note-editor'), { key: 'ArrowRight' });
        await waitFor(() =>
            expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id)?.startBeat)).toEqual([
                6, 6,
            ])
        );
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === sibling.id)?.velocity)).toEqual([80, 80]);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id)?.startBeat)).toEqual([
            5.5, 5.5,
        ]);
        await redo();
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id)?.startBeat)).toEqual([6, 6]);
    });

    it('moves a whole expressive note without changing its performed curve or onset pass', async () => {
        const projection = projectPianoRollTakeNotes(
            { id: 'clip', startBeat: 0, endBeat: 4 },
            'track',
            takeLaneStore.value
        );
        const view = projection.notes.find((note) => projection.ownersByViewId.get(note.id)?.row.id === expressive.id);
        if (!view) {
            throw new Error('Expected expressive selected note occurrence');
        }
        render(createElement(SelectedNoteEditor, { projection, viewId: view.id }));
        fireEvent.keyDown(screen.getByLabelText('selected-note-editor'), { key: 'ArrowRight' });
        await waitFor(() =>
            expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === expressive.id)?.startBeat)).toEqual([
                6.5, 6.5,
            ])
        );
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === expressive.id))).toEqual([
            { ...expressive, startBeat: 6.5 },
            { ...expressive, startBeat: 6.5 },
        ]);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === expressive.id))).toEqual([
            expressive,
            expressive,
        ]);
    });

    it('routes both resize edges through Command with the original expression and pass owner', async () => {
        const projection = projectPianoRollTakeNotes(
            { id: 'clip', startBeat: 0, endBeat: 4 },
            'track',
            takeLaneStore.value
        );
        const view = projection.notes.find((note) => projection.ownersByViewId.get(note.id)?.row.id === expressive.id);
        if (!view) {
            throw new Error('Expected expressive selected note occurrence');
        }
        render(createElement(SelectedNoteEditor, { projection, viewId: view.id }));
        const canvas = screen.getByLabelText('selected-note-editor');
        const y = 22 + (83 - expressive.pitch) * 16 + 8;

        fireEvent.mouseDown(canvas, { clientX: 76, clientY: y });
        fireEvent.mouseMove(canvas, { clientX: 56, clientY: y });
        fireEvent.mouseUp(canvas, { clientX: 56, clientY: y });
        await waitFor(() =>
            expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === expressive.id)?.duration)).toEqual([
                0.5, 0.5,
            ])
        );
        expect(
            rows()?.every((takeRows) => takeRows?.find((note) => note.id === expressive.id)?.expression === undefined)
        ).toBe(true);
        expect(await undo()).toEqual({ headConsumed: true });

        fireEvent.mouseDown(canvas, { clientX: 44, clientY: y });
        fireEvent.mouseMove(canvas, { clientX: 64, clientY: y });
        fireEvent.mouseUp(canvas, { clientX: 64, clientY: y });
        await waitFor(() =>
            expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === expressive.id)?.startBeat)).toEqual([
                6.5, 6.5,
            ])
        );
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === expressive.id)?.pressure)).toEqual([
            90, 90,
        ]);
        expect(await undo()).toEqual({ headConsumed: true });
        await redo();
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === expressive.id)?.startBeat)).toEqual([
            6.5, 6.5,
        ]);
    });

    it('deletes a selected occurrence and restores the same original row on Undo', async () => {
        const projection = projectPianoRollTakeNotes(
            { id: 'clip', startBeat: 0, endBeat: 4 },
            'track',
            takeLaneStore.value
        );
        const view = projection.notes.find((note) => projection.ownersByViewId.get(note.id)?.row.id === original.id);
        if (!view) {
            throw new Error('Expected selected note occurrence');
        }
        render(createElement(SelectedNoteEditor, { projection, viewId: view.id }));
        fireEvent.keyDown(screen.getByLabelText('selected-note-editor'), { key: 'Delete' });
        await waitFor(() =>
            expect(rows()?.map((takeRows) => takeRows?.some((note) => note.id === original.id))).toEqual([false, false])
        );
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === sibling.id)?.velocity)).toEqual([80, 80]);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id))).toEqual([
            original,
            original,
        ]);
    });

    it('step-inserts into the selected pass through the editor callback and undoes both copies', async () => {
        const projection = projectPianoRollTakeNotes(
            { id: 'clip', startBeat: 0, endBeat: 4 },
            'track',
            takeLaneStore.value
        );
        render(createElement(SelectedNoteEditor, { projection, stepInput: true }));
        const y = 22 + (83 - 70) * 16 + 8;
        fireEvent.mouseDown(screen.getByLabelText('selected-note-editor'), { clientX: 120, clientY: y });
        await waitFor(() => expect(rows()?.map((takeRows) => takeRows?.length)).toEqual([4, 4]));
        const inserted = rows()?.[0]?.find((note) => note.pitch === 70);
        expect(inserted).toEqual(expect.objectContaining({ startBeat: 8, recordingPassIndex: 1 }));
        expect(rows()?.[1]?.find((note) => note.id === inserted?.id)).toEqual(inserted);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rows()?.map((takeRows) => takeRows?.length)).toEqual([3, 3]);
    });

    it('quantizes repeated aliases on their captured pass grid through one grouped menu edit', async () => {
        const projection = mixedProjection();
        const repeated = projection.notes.filter(
            (note) => projection.ownersByViewId.get(note.id)?.row.id === original.id
        );
        const second = projection.notes.find(
            (note) => projection.ownersByViewId.get(note.id)?.row.id === 'second-pass-row'
        );
        expect(repeated).toHaveLength(2);
        if (!second) {
            throw new Error('Expected second selected pass');
        }
        renderTakeMenu(projection, new Set([...repeated.map((note) => note.id), second.id]), 2.4);
        fireEvent.click(screen.getAllByText('1/4')[0]!);
        await waitFor(() =>
            expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id)?.startBeat)).toEqual([
                6,
                6,
                undefined,
                undefined,
            ])
        );
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === 'second-pass-row')?.startBeat)).toEqual([
            undefined,
            undefined,
            9,
            9,
        ]);
        const replayed = projectPianoRollTakeNotes(
            { id: 'clip', startBeat: 0, endBeat: 12 },
            'track',
            takeLaneStore.value
        );
        expect(
            replayed.notes
                .filter((note) => replayed.ownersByViewId.get(note.id)?.row.id === original.id)
                .map((note) => note.startBeat)
        ).toEqual([1, 5]);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id)?.startBeat)).toEqual([
            5.5,
            5.5,
            undefined,
            undefined,
        ]);
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === 'second-pass-row')?.startBeat)).toEqual([
            undefined,
            undefined,
            9.4,
            9.4,
        ]);
    });

    it('quantizes a 3.7-beat repeated source once relative to its captured pass origin', async () => {
        const lane = takeLaneStore.value?.lanes[0];
        if (!lane) {
            throw new Error('Expected take lane');
        }
        const irregularSource = {
            ...structuredClone(source),
            sourceEndBeat: 8.7,
            phaseHeadBeat: 1.9,
            passLengthBeats: 3.7,
        };
        takeLaneStore.set({
            lanes: [
                {
                    ...lane,
                    activeCompRegions: [{ startBeat: 1.9, endBeat: 9.3, takeId: 'selected' }],
                    takes: lane.takes.map((take) => ({ ...take, midiSource: structuredClone(irregularSource) })),
                },
            ],
        });
        const projection = projectPianoRollTakeNotes(
            { id: 'clip', startBeat: 0, endBeat: 10 },
            'track',
            takeLaneStore.value
        );
        const aliases = projection.notes.filter(
            (note) => projection.ownersByViewId.get(note.id)?.row.id === original.id
        );
        expect(aliases).toHaveLength(2);
        expect(aliases[0]?.startBeat).toBeCloseTo(2.4);
        expect(aliases[1]?.startBeat).toBeCloseTo(6.1);
        renderTakeMenu(projection, new Set(aliases.map((note) => note.id)), 2.4);
        fireEvent.click(screen.getAllByText('1/4')[0]!);
        await waitFor(() =>
            expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id)?.startBeat)).toEqual([
                6, 6,
            ])
        );
        const replayed = projectPianoRollTakeNotes(
            { id: 'clip', startBeat: 0, endBeat: 10 },
            'track',
            takeLaneStore.value
        );
        const moved = replayed.notes.filter((note) => replayed.ownersByViewId.get(note.id)?.row.id === original.id);
        expect(moved[0]?.startBeat).toBeCloseTo(2.9);
        expect(moved[1]?.startBeat).toBeCloseTo(6.6);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id)?.startBeat)).toEqual([
            5.5, 5.5,
        ]);
    });

    it('transposes selected rows from two passes once each and preserves their pass identity', async () => {
        const projection = mixedProjection();
        renderTakeMenu(projection, new Set(projection.notes.map((note) => note.id)), 1);
        fireEvent.click(screen.getByText('+1'));
        await waitFor(() =>
            expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id)?.pitch)).toEqual([
                61,
                61,
                undefined,
                undefined,
            ])
        );
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === 'second-pass-row')?.pitch)).toEqual([
            undefined,
            undefined,
            71,
            71,
        ]);
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === sibling.id))).toEqual([
            { ...sibling, pitch: 65 },
            { ...sibling, pitch: 65 },
            undefined,
            undefined,
        ]);
        expect(
            rows()?.map((takeRows) => takeRows?.find((note) => note.id === 'second-pass-row')?.recordingPassIndex)
        ).toEqual([undefined, undefined, 0, 0]);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rows()?.map((takeRows) => takeRows?.find((note) => note.id === original.id)?.pitch)).toEqual([
            60,
            60,
            undefined,
            undefined,
        ]);
    });

    it('copies, cuts, pastes and duplicates selected pass rows through their original owners', async () => {
        const projection = mixedProjection();
        const repeated = projection.notes.filter(
            (note) => projection.ownersByViewId.get(note.id)?.row.id === original.id
        );
        const second = projection.notes.find(
            (note) => projection.ownersByViewId.get(note.id)?.row.id === 'second-pass-row'
        );
        if (!second) {
            throw new Error('Expected second selected pass');
        }
        const selected = new Set([...repeated.map((note) => note.id), second.id]);
        renderTakeMenu(projection, selected, 1);
        fireEvent.click(screen.getByText('Copy'));
        await waitFor(() => expect(getCopiedPianoRollNotes().map((note) => note.startBeat)).toEqual([0.5, 8.4]));
        copyPianoRollNotes([{ id: 'previous-copy', pitch: 48, startBeat: 0, duration: 1, velocity: 80 }]);
        fireEvent.click(screen.getByText('Cut'));
        await waitFor(() =>
            expect(rows()?.map((takeRows) => takeRows?.some((note) => note.id === original.id))).toEqual([
                false,
                false,
                false,
                false,
            ])
        );
        expect(rows()?.map((takeRows) => takeRows?.some((note) => note.id === 'second-pass-row'))).toEqual([
            false,
            false,
            false,
            false,
        ]);
        await waitFor(() => expect(getCopiedPianoRollNotes().map((note) => note.startBeat)).toEqual([0.5, 8.4]));
        expect(await undo()).toEqual({ headConsumed: true });
        await redo();
        expect(rows()?.map((takeRows) => takeRows?.some((note) => note.id === original.id))).toEqual([
            false,
            false,
            false,
            false,
        ]);
        expect(await undo()).toEqual({ headConsumed: true });

        fireEvent.click(screen.getByText('Paste'));
        await waitFor(() => expect(rows()?.map((takeRows) => takeRows?.length)).toEqual([4, 4, 2, 2]));
        const pastedFirst = rows()?.[0]?.find(
            (note) => note.id !== original.id && note.id !== sibling.id && note.id !== expressive.id
        );
        const pastedSecond = rows()?.[2]?.find((note) => note.id !== 'second-pass-row');
        expect(pastedFirst).toEqual(expect.objectContaining({ startBeat: 6, recordingPassIndex: 1 }));
        expect(pastedSecond).toEqual(expect.objectContaining({ recordingPassIndex: 0 }));
        expect(pastedSecond?.startBeat).toBeCloseTo(9.9);
        expect(rows()?.[1]?.find((note) => note.id === pastedFirst?.id)).toEqual(pastedFirst);
        expect(rows()?.[3]?.find((note) => note.id === pastedSecond?.id)).toEqual(pastedSecond);
        expect(await undo()).toEqual({ headConsumed: true });
        await redo();
        expect(rows()?.map((takeRows) => takeRows?.length)).toEqual([4, 4, 2, 2]);
        expect(await undo()).toEqual({ headConsumed: true });

        cleanup();
        renderTakeMenu(projection, new Set(repeated.map((note) => note.id)), 0.5);
        fireEvent.click(screen.getByText('Duplicate'));
        await waitFor(() => expect(rows()?.map((takeRows) => takeRows?.length)).toEqual([4, 4, 1, 1]));
        const duplicate = rows()?.[0]?.find(
            (note) => note.id !== original.id && note.id !== sibling.id && note.id !== expressive.id
        );
        expect(duplicate).toEqual(expect.objectContaining({ startBeat: 6.5, recordingPassIndex: 1 }));
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rows()?.map((takeRows) => takeRows?.length)).toEqual([3, 3, 1, 1]);
    });

    it.each([
        { label: '+1', frozenPitch: 61, basePitch: 63, frozenBeat: 5.5, baseBeat: 4.5 },
        { label: '1/4', frozenPitch: 60, basePitch: 62, frozenBeat: 6, baseBeat: 5 },
    ])('edits mixed original owners atomically through $label and one Undo', async (caseData) => {
        const projection = mixedGapProjection();
        const frozen = projection.notes.find((note) => projection.ownersByViewId.get(note.id)?.row.id === original.id);
        const base = projection.baseNotes.find(
            (note) => projection.baseOwnersByViewId.get(note.id)?.row.id === baseGapRow.id
        );
        if (!frozen || !base) {
            throw new Error('Expected mixed frozen and base note occurrences');
        }
        renderTakeMenu(projection, new Set([frozen.id, base.id]), 4.5);
        fireEvent.click(screen.getAllByText(caseData.label)[0]!);
        await waitFor(() =>
            expect(midiStore.value?.notesByClipId.clip?.[0]).toEqual(
                expect.objectContaining({ pitch: caseData.basePitch, startBeat: caseData.baseBeat })
            )
        );
        expect(rows()?.[0]?.find((note) => note.id === original.id)).toEqual(
            expect.objectContaining({
                pitch: caseData.frozenPitch,
                startBeat: caseData.frozenBeat,
                recordingPassIndex: 1,
            })
        );
        expect(midiStore.value?.notesByClipId.clip?.[0]).toEqual(
            expect.objectContaining({ pitch: caseData.basePitch, startBeat: caseData.baseBeat })
        );
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rows()?.[0]?.find((note) => note.id === original.id)).toEqual(original);
        expect(midiStore.value?.notesByClipId.clip?.[0]).toEqual(baseGapRow);
        await redo();
        expect(rows()?.[0]?.find((note) => note.id === original.id)?.startBeat).toBe(caseData.frozenBeat);
        expect(midiStore.value?.notesByClipId.clip?.[0]?.startBeat).toBe(caseData.baseBeat);
    });

    it('duplicates frozen and base selections across owner boundaries in one Command', async () => {
        const projection = mixedGapProjection();
        const frozen = projection.notes.find((note) => projection.ownersByViewId.get(note.id)?.row.id === original.id);
        const base = projection.baseNotes.find(
            (note) => projection.baseOwnersByViewId.get(note.id)?.row.id === baseGapRow.id
        );
        if (!frozen || !base) {
            throw new Error('Expected mixed frozen and base note occurrences');
        }
        renderTakeMenu(projection, new Set([frozen.id, base.id]), 4.5);
        fireEvent.click(screen.getByText('Duplicate'));
        await waitFor(() => expect(midiStore.value?.notesByClipId.clip).toHaveLength(2));
        expect(midiStore.value?.notesByClipId.clip?.find((note) => note.id !== baseGapRow.id)).toEqual(
            expect.objectContaining({ startBeat: 5, pitch: original.pitch })
        );
        expect(rows()?.[2]?.find((note) => note.id !== 'second-pass-row')).toEqual(
            expect.objectContaining({ startBeat: 10, pitch: baseGapRow.pitch, recordingPassIndex: 0 })
        );
        expect(await undo()).toEqual({ headConsumed: true });
        expect(midiStore.value?.notesByClipId.clip).toEqual([baseGapRow]);
        expect(rows()?.[2]).toHaveLength(1);
    });

    it('refuses a late base peer conflict before changing the frozen owner or history', async () => {
        const projection = mixedGapProjection();
        const frozen = projection.notes.find((note) => projection.ownersByViewId.get(note.id)?.row.id === original.id);
        const base = projection.baseNotes.find(
            (note) => projection.baseOwnersByViewId.get(note.id)?.row.id === baseGapRow.id
        );
        if (!frozen || !base) {
            throw new Error('Expected mixed frozen and base note occurrences');
        }
        const historyLength = undoStore.value?.past.length;
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: { ...midiStore.value!.notesByClipId, clip: [{ ...baseGapRow, pitch: 70 }] },
        });
        expect(
            await transformPianoRollTakeNotes(
                projection,
                'clip',
                new Set([frozen.id, base.id]),
                { kind: 'transpose', semitones: 1 },
                'Transpose mixed notes'
            )
        ).toBe(false);
        expect(rows()?.[0]?.find((note) => note.id === original.id)).toEqual(original);
        expect(midiStore.value?.notesByClipId.clip).toEqual([{ ...baseGapRow, pitch: 70 }]);
        expect(undoStore.value?.past.length).toBe(historyLength);
    });

    it('refuses an unknown selected owner before editing a valid selected row', async () => {
        const projection = mixedGapProjection();
        const frozen = projection.notes.find((note) => projection.ownersByViewId.get(note.id)?.row.id === original.id);
        if (!frozen) {
            throw new Error('Expected selected frozen occurrence');
        }
        const historyLength = undoStore.value?.past.length;
        expect(
            await transformPianoRollTakeNotes(
                projection,
                'clip',
                new Set([frozen.id, 'stale-selected-view']),
                { kind: 'transpose', semitones: 1 },
                'Transpose mixed notes'
            )
        ).toBe(false);
        expect(rows()?.[0]?.find((note) => note.id === original.id)).toEqual(original);
        expect(undoStore.value?.past.length).toBe(historyLength);
    });

    it('keeps the prior clipboard and both owners when a peer changes a selected base row before Cut', async () => {
        const projection = mixedGapProjection();
        const frozen = projection.notes.find((note) => projection.ownersByViewId.get(note.id)?.row.id === original.id);
        const base = projection.baseNotes.find(
            (note) => projection.baseOwnersByViewId.get(note.id)?.row.id === baseGapRow.id
        );
        if (!frozen || !base) {
            throw new Error('Expected mixed frozen and base note occurrences');
        }
        const previous = { id: 'previous-copy', pitch: 48, startBeat: 0, duration: 1, velocity: 80 };
        copyPianoRollNotes([previous]);
        const historyLength = undoStore.value?.past.length;
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: { ...midiStore.value!.notesByClipId, clip: [{ ...baseGapRow, pitch: 70 }] },
        });
        expect(await cutPianoRollTakeNotes(projection, 'clip', new Set([frozen.id, base.id]))).toBe(false);
        expect(getCopiedPianoRollNotes()).toEqual([previous]);
        expect(rows()?.[0]?.find((note) => note.id === original.id)).toEqual(original);
        expect(midiStore.value?.notesByClipId.clip).toEqual([{ ...baseGapRow, pitch: 70 }]);
        expect(undoStore.value?.past.length).toBe(historyLength);
    });

    it('does not delete when a selected copy cannot be validated or one owner is absent', async () => {
        const projection = mixedGapProjection();
        const frozen = projection.notes.find((note) => projection.ownersByViewId.get(note.id)?.row.id === original.id);
        const base = projection.baseNotes.find(
            (note) => projection.baseOwnersByViewId.get(note.id)?.row.id === baseGapRow.id
        );
        if (!frozen || !base) {
            throw new Error('Expected mixed frozen and base note occurrences');
        }
        const previous = { id: 'previous-copy', pitch: 48, startBeat: 0, duration: 1, velocity: 80 };
        copyPianoRollNotes([previous]);
        const historyLength = undoStore.value?.past.length;
        const malformed = {
            ...projection,
            notes: projection.notes.map((note) => (note.id === frozen.id ? { ...note, velocity: Number.NaN } : note)),
        };
        expect(await cutPianoRollTakeNotes(malformed, 'clip', new Set([frozen.id, base.id]))).toBe(false);
        expect(await cutPianoRollTakeNotes(projection, 'clip', new Set([frozen.id, 'missing-view']))).toBe(false);
        expect(getCopiedPianoRollNotes()).toEqual([previous]);
        expect(rows()?.[0]?.find((note) => note.id === original.id)).toEqual(original);
        expect(midiStore.value?.notesByClipId.clip).toEqual([baseGapRow]);
        expect(undoStore.value?.past.length).toBe(historyLength);
    });
});
