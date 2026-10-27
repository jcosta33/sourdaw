import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeUserAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
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

import { takeLaneStore, type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};
const edited = {
    id: 'selected-note',
    pitch: 60,
    startBeat: 5.5,
    duration: 1,
    velocity: 90,
    recordingPassIndex: 1,
    pressure: 0,
};
const sibling = { id: 'peer-note', pitch: 64, startBeat: 6.5, duration: 1, velocity: 80 };
const source = {
    sourceClipId: 'original',
    sourceEntryBeat: 5,
    sourceEndBeat: 9,
    phaseHeadBeat: 0,
    passLengthBeats: 4,
    rows: {
        notes: { present: true as const, value: [edited, sibling] },
        controlChanges: { present: true as const, value: [] },
        pitchBends: { present: true as const, value: [] },
    },
};

function frozenRows() {
    return takeLaneStore.value?.lanes[0]?.takes.map((take) => take.midiSource?.rows.notes.value);
}

function documentRows() {
    return getCrdtDoc<{ takeLanes?: TakeLaneStoreState }>('root')?.takeLanes?.lanes[0]?.takes.map(
        (take) => take.midiSource?.rows.notes.value
    );
}

function editPeerRows(): void {
    const state = takeLaneStore.value;
    if (!state) {
        throw new Error('Expected take lane state');
    }
    takeLaneStore.set({
        lanes: state.lanes.map((lane) => ({
            ...lane,
            takes: lane.takes.map((take) => {
                const source = take.midiSource;
                if (!source) {
                    return take;
                }
                return {
                    ...take,
                    midiSource: {
                        ...source,
                        rows: {
                            ...source.rows,
                            notes: {
                                present: true as const,
                                value: source.rows.notes.value.map((note) =>
                                    note.id === sibling.id ? { ...note, velocity: 112 } : note
                                ),
                            },
                        },
                    },
                };
            }),
        })),
    });
}

describe('replaceOriginalMidiTakeRow registered action', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('replace original MIDI take row');
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
                    activeCompRegions: [],
                    takes: [
                        {
                            id: 'selected',
                            clipId: 'left',
                            name: 'Selected',
                            selected: true,
                            startBeat: 0,
                            endBeat: 4,
                            recordingPassIndex: 1,
                            midiSource: structuredClone(source),
                        },
                        {
                            id: 'other-fragment',
                            clipId: 'right',
                            name: 'Other',
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

    it('edits one original owner through Command and preserves a peer sibling through Undo and Redo', async () => {
        const replacement = { ...edited, velocity: 71 };
        await executeUserAppAction({
            type: 'replaceOriginalMidiTakeRow',
            payload: {
                laneId: 'lane',
                takeId: 'selected',
                sourceClipId: 'original',
                rowId: edited.id,
                rowKind: 'note',
                expected: edited,
                replacement,
                expectedSlotPresent: true,
                replacementSlotPresent: true,
            },
        });
        expect(frozenRows()).toEqual([
            [replacement, sibling],
            [replacement, sibling],
        ]);
        flushAutomergeStorageWrites();
        expect(documentRows()).toEqual(frozenRows());
        expect(Object.hasOwn(frozenRows()?.[0]?.[0] ?? {}, 'pressure')).toBe(true);

        editPeerRows();
        flushAutomergeStorageWrites();
        expect(await undo()).toEqual({ headConsumed: true });
        expect(frozenRows()?.map((rows) => rows?.map((note) => note.velocity))).toEqual([
            [90, 112],
            [90, 112],
        ]);
        await redo();
        expect(frozenRows()?.map((rows) => rows?.map((note) => note.velocity))).toEqual([
            [71, 112],
            [71, 112],
        ]);
        expect(documentRows()).toEqual(frozenRows());
    });

    it('refuses stale row and source owner without consuming command history', async () => {
        const before = structuredClone(takeLaneStore.value);
        const beforeCount = undoHistoryStore.value?.past.length;
        await executeUserAppAction({
                type: 'replaceOriginalMidiTakeRow',
                payload: {
                    laneId: 'lane',
                    takeId: 'selected',
                    sourceClipId: 'wrong',
                    rowId: edited.id,
                    rowKind: 'note',
                    expected: edited,
                    replacement: { ...edited, velocity: 71 },
                    expectedSlotPresent: true,
                    replacementSlotPresent: true,
                },
            });
        expect(takeLaneStore.value).toEqual(before);
        expect(undoHistoryStore.value?.past.length).toBe(beforeCount);
    });

    it('adds a selected-pass note and restores source slot membership through Undo and Redo', async () => {
        const added = {
            id: 'new-selected',
            pitch: 67,
            startBeat: 7,
            duration: 0.5,
            velocity: 100,
            recordingPassIndex: 1,
        };
        await executeUserAppAction({
            type: 'replaceOriginalMidiTakeRow',
            payload: {
                laneId: 'lane',
                takeId: 'selected',
                sourceClipId: 'original',
                rowId: added.id,
                rowKind: 'note',
                expected: null,
                replacement: added,
                expectedSlotPresent: true,
                replacementSlotPresent: true,
            },
        });
        expect(frozenRows()?.map((rows) => rows?.at(-1)?.id)).toEqual([added.id, added.id]);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(frozenRows()?.map((rows) => rows?.some((note) => note.id === added.id))).toEqual([false, false]);
        await redo();
        expect(frozenRows()?.map((rows) => rows?.at(-1)?.recordingPassIndex)).toEqual([1, 1]);
    });

    it('returns an originally absent note slot to absence when the inserted note is undone', async () => {
        const state = takeLaneStore.value;
        if (!state) {
            throw new Error('Expected take lane state');
        }
        takeLaneStore.set({
            lanes: state.lanes.map((lane) => ({
                ...lane,
                takes: lane.takes.map((take) => {
                    const captured = take.midiSource;
                    return captured
                        ? {
                              ...take,
                              midiSource: {
                                  ...captured,
                                  rows: { ...captured.rows, notes: { present: false, value: [] } },
                              },
                          }
                        : take;
                }),
            })),
        });
        flushAutomergeStorageWrites();
        const added = {
            id: 'from-empty',
            pitch: 67,
            startBeat: 7,
            duration: 0.5,
            velocity: 100,
            recordingPassIndex: 1,
        };
        const payload = {
            laneId: 'lane',
            takeId: 'selected',
            sourceClipId: 'original',
            rowId: added.id,
            rowKind: 'note' as const,
            expected: null,
            replacement: added,
            expectedSlotPresent: false,
            replacementSlotPresent: true,
        };
        await executeUserAppAction({ type: 'replaceOriginalMidiTakeRow', payload });
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.midiSource?.rows.notes.present)).toEqual([
            true,
            true,
        ]);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.midiSource?.rows.notes)).toEqual([
            { present: false, value: [] },
            { present: false, value: [] },
        ]);
        await redo();
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.midiSource?.rows.notes.value[0]?.id)).toEqual([
            added.id,
            added.id,
        ]);
    });

    it('refuses a new note assigned to another pass and keeps same-row peer changes outside Undo', async () => {
        const wrongPass = {
            id: 'wrong-pass',
            pitch: 67,
            startBeat: 7,
            duration: 0.5,
            velocity: 100,
            recordingPassIndex: 0,
        };
        const before = structuredClone(takeLaneStore.value);
        await executeUserAppAction({
                type: 'replaceOriginalMidiTakeRow',
                payload: {
                    laneId: 'lane',
                    takeId: 'selected',
                    sourceClipId: 'original',
                    rowId: wrongPass.id,
                    rowKind: 'note',
                    expected: null,
                    replacement: wrongPass,
                    expectedSlotPresent: true,
                    replacementSlotPresent: true,
                },
            });
        expect(takeLaneStore.value).toEqual(before);
        expect(undoHistoryStore.value?.past).toHaveLength(0);

        await executeUserAppAction({
            type: 'replaceOriginalMidiTakeRow',
            payload: {
                laneId: 'lane',
                takeId: 'selected',
                sourceClipId: 'original',
                rowId: edited.id,
                rowKind: 'note',
                expected: edited,
                replacement: { ...edited, velocity: 71 },
                expectedSlotPresent: true,
                replacementSlotPresent: true,
            },
        });
        const state = takeLaneStore.value;
        if (!state) {
            throw new Error('Expected take lane state');
        }
        takeLaneStore.set({
            lanes: state.lanes.map((lane) => ({
                ...lane,
                takes: lane.takes.map((take) => {
                    const captured = take.midiSource;
                    return captured
                        ? {
                              ...take,
                              midiSource: {
                                  ...captured,
                                  rows: {
                                      ...captured.rows,
                                      notes: {
                                          present: true,
                                          value: captured.rows.notes.value.map((note) =>
                                              note.id === edited.id ? { ...note, velocity: 55 } : note
                                          ),
                                      },
                                  },
                              },
                          }
                        : take;
                }),
            })),
        });
        flushAutomergeStorageWrites();
        const peer = structuredClone(takeLaneStore.value);
        expect(await undo()).toEqual({ headConsumed: false });
        expect(takeLaneStore.value).toEqual(peer);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
    });
});
