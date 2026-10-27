import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
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
        await expect(
            executeUserAppAction({
                type: 'replaceOriginalMidiTakeRow',
                payload: {
                    laneId: 'lane',
                    takeId: 'selected',
                    sourceClipId: 'wrong',
                    rowId: edited.id,
                    rowKind: 'note',
                    expected: edited,
                    replacement: { ...edited, velocity: 71 },
                },
            })
        ).rejects.toThrow();
        expect(takeLaneStore.value).toEqual(before);
        expect(undoHistoryStore.value?.past.length).toBe(beforeCount);
    });
});
