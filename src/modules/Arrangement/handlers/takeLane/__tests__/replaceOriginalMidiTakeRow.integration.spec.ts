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
    executeAppActionBatch,
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

import { type AppAction } from '#/utils/handlerContract';

import { takeLaneStore, type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { handleReplaceOriginalMidiTakeRow } from '../replaceOriginalMidiTakeRow';

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

type RowAction = Extract<AppAction, { type: 'replaceOriginalMidiTakeRow' }>;
function editAction(expected = edited, replacement = { ...edited, velocity: 71 }): RowAction {
    return {
        type: 'replaceOriginalMidiTakeRow',
        payload: {
            laneId: 'lane',
            takeId: 'selected',
            sourceClipId: 'original',
            rowId: edited.id,
            rowKind: 'note',
            expected,
            replacement,
            expectedSlotPresent: true,
            replacementSlotPresent: true,
            copyScope: 'capture',
        },
    };
}
function stateSnapshot() {
    return {
        projected: structuredClone(takeLaneStore.value),
        raw: getCrdtDoc<{ takeLanes?: TakeLaneStoreState }>('root')?.takeLanes,
        history: structuredClone(undoHistoryStore.value),
    };
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

    it.each(['note', 'cc', 'bend'] as const)(
        'limits %s Delete/Undo/Redo to the witnessed copies and exact row position',
        async (kind) => {
            const state = structuredClone(takeLaneStore.value);
            if (!state) throw new Error('Missing take state');
            const selected = state.lanes[0]!.takes[0]!;
            const other = state.lanes[0]!.takes[1]!;
            if (!selected.midiSource || !other.midiSource) throw new Error('Missing sources');
            const cc = { id: 'owned-cc', controller: 64, value: 127, channel: 1, beat: 5.5 };
            const peerCc = { ...cc, id: 'peer-cc', value: 80, beat: 6.5 };
            const bend = { id: 'owned-bend', value: 2048, channel: 1, beat: 5.5 };
            const peerBend = { ...bend, id: 'peer-bend', value: 80, beat: 6.5 };
            let action: RowAction;
            const common = {
                laneId: 'lane',
                takeId: 'selected',
                sourceClipId: 'original',
                expectedSlotPresent: true,
                replacementSlotPresent: true,
                copyScope: 'capture' as const,
            };
            if (kind === 'note') {
                other.midiSource = {
                    ...other.midiSource,
                    rows: { ...other.midiSource.rows, notes: { present: true, value: [sibling] } },
                };
                action = {
                    type: 'replaceOriginalMidiTakeRow',
                    payload: { ...common, rowKind: 'note', rowId: edited.id, expected: edited, replacement: null },
                };
            } else if (kind === 'cc') {
                selected.midiSource = {
                    ...selected.midiSource,
                    rows: { ...selected.midiSource.rows, controlChanges: { present: true, value: [cc, peerCc] } },
                };
                other.midiSource = {
                    ...other.midiSource,
                    rows: { ...other.midiSource.rows, controlChanges: { present: false, value: [] } },
                };
                action = {
                    type: 'replaceOriginalMidiTakeRow',
                    payload: { ...common, rowKind: 'cc', rowId: cc.id, expected: cc, replacement: null },
                };
            } else {
                selected.midiSource = {
                    ...selected.midiSource,
                    rows: { ...selected.midiSource.rows, pitchBends: { present: true, value: [bend, peerBend] } },
                };
                other.midiSource = {
                    ...other.midiSource,
                    rows: { ...other.midiSource.rows, pitchBends: { present: false, value: [] } },
                };
                action = {
                    type: 'replaceOriginalMidiTakeRow',
                    payload: { ...common, rowKind: 'bend', rowId: bend.id, expected: bend, replacement: null },
                };
            }
            state.lanes[0]!.takes.push({ ...structuredClone(selected), id: 'shared-present' });
            takeLaneStore.set(state);
            flushAutomergeStorageWrites();
            const untouched = structuredClone(other.midiSource);
            await executeUserAppAction(action);
            const entry = undoHistoryStore.value?.past[0];
            if (entry?.kind !== 'action' || entry.action.type !== 'replaceOriginalMidiTakeRow')
                throw new Error('Missing row history');
            expect(entry.action.payload.copyScope).toHaveLength(2);
            expect(takeLaneStore.value?.lanes[0]?.takes[1]?.midiSource).toEqual(untouched);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            const afterDelete = structuredClone(takeLaneStore.value);
            if (!afterDelete) throw new Error('Missing deleted state');
            const sourceAfterDelete = afterDelete.lanes[0]!.takes[0]!.midiSource;
            if (!sourceAfterDelete) throw new Error('Missing selected source');
            // A peer row edit remains outside this inverse's authority.
            afterDelete.lanes[0]!.takes[0]!.midiSource = {
                ...sourceAfterDelete,
                rows: {
                    ...sourceAfterDelete.rows,
                    ...(kind === 'note'
                        ? {
                              notes: {
                                  ...sourceAfterDelete.rows.notes,
                                  value: sourceAfterDelete.rows.notes.value.map((row) => ({ ...row, velocity: 111 })),
                              },
                          }
                        : {}),
                    ...(kind === 'cc'
                        ? {
                              controlChanges: {
                                  ...sourceAfterDelete.rows.controlChanges,
                                  value: sourceAfterDelete.rows.controlChanges.value.map((row) => ({
                                      ...row,
                                      value: 111,
                                  })),
                              },
                          }
                        : {}),
                    ...(kind === 'bend'
                        ? {
                              pitchBends: {
                                  ...sourceAfterDelete.rows.pitchBends,
                                  value: sourceAfterDelete.rows.pitchBends.value.map((row) => ({ ...row, value: 111 })),
                              },
                          }
                        : {}),
                },
            };
            afterDelete.lanes[0]!.takes.push({ ...structuredClone(other), id: 'new-copy' });
            takeLaneStore.set(afterDelete);
            flushAutomergeStorageWrites();
            expect(await undo()).toEqual({ headConsumed: true });
            const restored = takeLaneStore.value?.lanes[0]?.takes[0]?.midiSource;
            const shared = takeLaneStore.value?.lanes[0]?.takes[2]?.midiSource;
            if (!restored) throw new Error('Missing restored source');
            expect(shared).toEqual(selected.midiSource);
            if (kind === 'note') expect(restored.rows.notes.value).toEqual([edited, { ...sibling, velocity: 111 }]);
            if (kind === 'cc') expect(restored.rows.controlChanges.value).toEqual([cc, { ...peerCc, value: 111 }]);
            if (kind === 'bend') expect(restored.rows.pitchBends.value).toEqual([bend, { ...peerBend, value: 111 }]);
            expect(takeLaneStore.value?.lanes[0]?.takes[1]?.midiSource).toEqual(untouched);
            expect(takeLaneStore.value?.lanes[0]?.takes[3]?.midiSource).toEqual(untouched);
            expect(stateSnapshot().raw).toEqual(takeLaneStore.value);
            expect(undoHistoryStore.value?.past).toHaveLength(0);
            expect(undoHistoryStore.value?.future).toHaveLength(1);
            await redo();
            expect(takeLaneStore.value).toEqual(afterDelete);
            expect(stateSnapshot().raw).toEqual(takeLaneStore.value);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expect(undoHistoryStore.value?.future).toHaveLength(0);
        }
    );

    it.each([undefined, 0])(
        'restores an original note pass identity %s instead of assigning the selected take pass',
        async (recordingPassIndex) => {
            const { recordingPassIndex: _previousPass, ...legacy } = edited;
            const original = recordingPassIndex === undefined ? legacy : { ...legacy, recordingPassIndex };
            const state = structuredClone(takeLaneStore.value);
            if (!state) throw new Error('Missing state');
            state.lanes[0]!.takes = state.lanes[0]!.takes.map((take) => {
                const source = take.midiSource;
                if (!source) throw new Error('Missing source');
                return {
                    ...take,
                    midiSource: {
                        ...source,
                        rows: {
                            ...source.rows,
                            notes: {
                                ...source.rows.notes,
                                value: source.rows.notes.value.map((row) => (row.id === edited.id ? original : row)),
                            },
                        },
                    },
                };
            });
            takeLaneStore.set(state);
            flushAutomergeStorageWrites();
            const before = stateSnapshot();
            await executeUserAppAction({
                type: 'replaceOriginalMidiTakeRow',
                payload: {
                    laneId: 'lane',
                    takeId: 'selected',
                    sourceClipId: 'original',
                    rowId: original.id,
                    rowKind: 'note',
                    expected: original,
                    replacement: null,
                    expectedSlotPresent: true,
                    replacementSlotPresent: true,
                    copyScope: 'capture',
                },
            });
            expect(frozenRows()).toEqual([[sibling], [sibling]]);
            expect(await undo()).toEqual({ headConsumed: true });
            expect(takeLaneStore.value).toEqual(before.projected);
            expect(stateSnapshot().raw).toEqual(before.raw);
            expect(Object.hasOwn(frozenRows()?.[0]?.[0] ?? {}, 'recordingPassIndex')).toBe(
                recordingPassIndex !== undefined
            );
        }
    );

    it('restores each copy slot presence after inserting into heterogeneous note buckets', async () => {
        const state = structuredClone(takeLaneStore.value);
        if (!state) throw new Error('Missing state');
        const owner = state.lanes[0]!.takes[0]!;
        const other = state.lanes[0]!.takes[1]!;
        if (!owner.midiSource || !other.midiSource) throw new Error('Missing sources');
        owner.midiSource = {
            ...owner.midiSource,
            rows: { ...owner.midiSource.rows, notes: { present: false, value: [] } },
        };
        other.midiSource = {
            ...other.midiSource,
            rows: { ...other.midiSource.rows, notes: { present: true, value: [sibling] } },
        };
        takeLaneStore.set(state);
        flushAutomergeStorageWrites();
        const before = stateSnapshot();
        const inserted = { ...edited, id: 'inserted' };
        await executeUserAppAction({
            type: 'replaceOriginalMidiTakeRow',
            payload: {
                laneId: 'lane',
                takeId: 'selected',
                sourceClipId: 'original',
                rowId: inserted.id,
                rowKind: 'note',
                expected: null,
                replacement: inserted,
                expectedSlotPresent: false,
                replacementSlotPresent: true,
                copyScope: 'capture',
            },
        });
        expect(frozenRows()).toEqual([[inserted], [sibling, inserted]]);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(takeLaneStore.value).toEqual(before.projected);
        expect(stateSnapshot().raw).toEqual(before.raw);
        await redo();
        expect(frozenRows()).toEqual([[inserted], [sibling, inserted]]);
    });

    it.each(['missing copy', 'stale row', 'missing insertion neighbour'] as const)(
        'refuses Undo atomically after a %s',
        async (change) => {
            await executeUserAppAction({ ...editAction(), payload: { ...editAction().payload, replacement: null } });
            const state = structuredClone(takeLaneStore.value);
            if (!state) throw new Error('Missing state');
            if (change === 'missing copy') state.lanes[0]!.takes.splice(1, 1);
            else {
                const source = state.lanes[0]!.takes[1]?.midiSource;
                if (!source) throw new Error('Missing source');
                state.lanes[0]!.takes[1]!.midiSource = {
                    ...source,
                    rows: {
                        ...source.rows,
                        notes: {
                            ...source.rows.notes,
                            value:
                                change === 'stale row' ? [...source.rows.notes.value, { ...edited, velocity: 12 }] : [],
                        },
                    },
                };
            }
            takeLaneStore.set(state);
            flushAutomergeStorageWrites();
            const before = stateSnapshot();
            expect(await undo()).toEqual({ headConsumed: false });
            flushAutomergeStorageWrites();
            expect(stateSnapshot()).toEqual(before);
        }
    );

    it.each([undefined, 'capture'] as const)(
        'refuses actual Undo with unproved copy scope %s before it can be captured',
        async (copyScope) => {
            await executeUserAppAction(editAction());
            const entry = undoHistoryStore.value?.past[0];
            if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'replaceOriginalMidiTakeRow')
                throw new Error('Missing inverse');
            const { copyScope: _previousScope, ...unwitnessed } = entry.inverseAction.payload;
            const payload: RowAction['payload'] = copyScope === 'capture' ? { ...unwitnessed, copyScope } : unwitnessed;
            const forged = { ...entry, inverseAction: { ...entry.inverseAction, payload } };
            expect(handleReplaceOriginalMidiTakeRow.validateSessionEntry?.(forged)).toBe(false);
            undoHistoryStore.set({ past: [forged], future: [] });
            const before = stateSnapshot();
            expect(await undo()).toEqual({ headConsumed: false });
            flushAutomergeStorageWrites();
            expect(stateSnapshot()).toEqual(before);
        }
    );

    it('refuses forged Redo capture without changing project or future history', async () => {
        await executeUserAppAction(editAction());
        expect(await undo()).toEqual({ headConsumed: true });
        const entry = undoHistoryStore.value?.future[0];
        if (entry?.kind !== 'action' || entry.redoAction?.type !== 'replaceOriginalMidiTakeRow')
            throw new Error('Missing redo');
        const forged = {
            ...entry,
            redoAction: {
                ...entry.redoAction,
                payload: { ...entry.redoAction.payload, copyScope: 'capture' as const },
            },
        };
        undoHistoryStore.set({ past: [], future: [forged] });
        const before = stateSnapshot();
        await redo();
        flushAutomergeStorageWrites();
        expect(stateSnapshot()).toEqual(before);
    });

    it('refuses forged capture in grouped Redo without partial project or history writes', async () => {
        await executeAppActionBatch(
            [editAction(), editAction({ ...edited, velocity: 71 }, { ...edited, velocity: 62 })],
            { groupId: 'row-group', groupLabel: 'Edit frozen notes' }
        );
        expect(await undo()).toEqual({ headConsumed: true });
        const future = undoHistoryStore.value!.future.map((entry, index) => {
            if (index !== 0 || entry.kind !== 'action' || entry.redoAction?.type !== 'replaceOriginalMidiTakeRow')
                return entry;
            return {
                ...entry,
                redoAction: {
                    ...entry.redoAction,
                    payload: { ...entry.redoAction.payload, copyScope: 'capture' as const },
                },
            };
        });
        undoHistoryStore.set({ past: [], future });
        const before = stateSnapshot();
        await redo();
        flushAutomergeStorageWrites();
        expect(stateSnapshot()).toEqual(before);
    });

    it.each([false, true])('keeps grouped Undo/Redo scope immutable, forged capture: %s', async (forge) => {
        await executeAppActionBatch(
            [editAction(), editAction({ ...edited, velocity: 71 }, { ...edited, velocity: 62 })],
            { groupId: 'row-group', groupLabel: 'Edit frozen notes' }
        );
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        if (forge) {
            const past = undoHistoryStore.value!.past.map((entry, index) => {
                if (
                    index !== 1 ||
                    entry.kind !== 'action' ||
                    entry.inverseAction?.type !== 'replaceOriginalMidiTakeRow'
                )
                    return entry;
                return {
                    ...entry,
                    inverseAction: {
                        ...entry.inverseAction,
                        payload: { ...entry.inverseAction.payload, copyScope: 'capture' as const },
                    },
                };
            });
            undoHistoryStore.set({ past, future: [] });
            const before = stateSnapshot();
            expect(await undo()).toEqual({ headConsumed: false });
            expect(stateSnapshot()).toEqual(before);
            return;
        }
        expect(await undo()).toEqual({ headConsumed: true });
        expect(frozenRows()?.map((rows) => rows?.[0]?.velocity)).toEqual([90, 90]);
        expect(undoHistoryStore.value?.future).toHaveLength(2);
        await redo();
        expect(frozenRows()?.map((rows) => rows?.[0]?.velocity)).toEqual([62, 62]);
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        expect(undoHistoryStore.value?.future).toHaveLength(0);
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
                copyScope: 'capture',
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

    it('refuses a stale selection prefix even when the current owner accepts the edit', () => {
        const action = {
            type: 'replaceOriginalMidiTakeRow' as const,
            payload: {
                laneId: 'lane',
                takeId: 'selected',
                sourceClipId: 'original',
                rowId: edited.id,
                rowKind: 'note' as const,
                copyScope: 'capture' as const,
                expected: edited,
                replacement: { ...edited, velocity: 71 },
                expectedSlotPresent: true,
                replacementSlotPresent: true,
            },
        };
        const staleSelection = {
            type: 'selectTake' as const,
            payload: {
                trackId: 'track',
                takeId: 'selected',
                expectedLaneId: 'lane',
                expectedSelectedTakeId: 'other-fragment',
            },
        };
        handleReplaceOriginalMidiTakeRow.materializeCommandArguments?.(action);
        const before = structuredClone(takeLaneStore.value);
        expect(handleReplaceOriginalMidiTakeRow.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
        expect(
            handleReplaceOriginalMidiTakeRow.validate?.(action, {
                actions: [staleSelection, action],
                actionIndex: 1,
            })
        ).toBe(false);
        expect(takeLaneStore.value).toEqual(before);
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
                copyScope: 'capture',
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
                copyScope: 'capture',
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
                    if (!captured) {
                        return take;
                    }
                    return {
                        ...take,
                        midiSource: {
                            ...captured,
                            rows: { ...captured.rows, notes: { present: false, value: [] } },
                        },
                    };
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
            copyScope: 'capture' as const,
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
                copyScope: 'capture',
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
                copyScope: 'capture',
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
                    if (!captured) {
                        return take;
                    }
                    return {
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
                    };
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
