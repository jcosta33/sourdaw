import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { batchStoreUpdates } from '#/infra/store/createStore';
import * as automergeStorage from '#/infra/store/storage/createAutomergeStorage';
import { clipSelectionStore, defaultTrackState, trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import {
    addClip,
    createTrack,
    getArrangementHandlers,
    selectClipWithFocus,
    setClipSelection,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    captureUndoHistory,
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    setCommandEventBus,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore, captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import * as duplicateIntents from '../../clipShortcuts/enqueueClipDuplicate';
import { handleKeydown } from '../handleKeydown';

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function clips() {
    return trackStore.value?.tracks.flatMap((track) => track.clips) ?? [];
}

function geometry() {
    return clips().map(({ id, startBeat, endBeat }) => ({ id, startBeat, endBeat }));
}

function projectSnapshot(): string | undefined {
    return JSON.stringify(getCrdtDoc('root'));
}

function expectRawMatchesProjection(): void {
    const doc = getCrdtDoc<{ tracks: TrackStoreState; midi: NonNullable<typeof midiStore.value> }>('root');
    expect(doc?.tracks.tracks.flatMap((track) => track.clips)).toEqual(clips());
    expect(doc?.midi.notesByClipId).toEqual(midiStore.value?.notesByClipId);
    expect(doc?.midi.ccByClipId).toEqual(midiStore.value?.ccByClipId);
    expect(doc?.midi.pitchBendByClipId).toEqual(midiStore.value?.pitchBendByClipId);
}

function withoutRowIds<TRow extends { id: string }>(rows: TRow[]) {
    return rows.map(({ id: _id, ...row }) => row);
}

// Only generated note identities are outside the musical replay oracle.
function musicalContent() {
    const state = midiStore.value;
    return (
        state && {
            ...state,
            notesByClipId: Object.fromEntries(
                Object.entries(state.notesByClipId).map(([clipId, rows]) => [
                    clipId,
                    clipId === 'source' || clipId === 'other' ? rows : withoutRowIds(rows),
                ])
            ),
        }
    );
}

function expectSurvivingMidi(sourceIds: string[], before: typeof midiStore.value): void {
    for (const [index, clip] of clips().entries()) {
        const sourceId = sourceIds[index % sourceIds.length]!;
        expect(withoutRowIds(midiStore.value?.notesByClipId[clip.id] ?? [])).toEqual(
            withoutRowIds(before?.notesByClipId[sourceId] ?? [])
        );
        expect(withoutRowIds(midiStore.value?.ccByClipId[clip.id] ?? [])).toEqual(
            withoutRowIds(before?.ccByClipId[sourceId] ?? [])
        );
        expect(withoutRowIds(midiStore.value?.pitchBendByClipId[clip.id] ?? [])).toEqual(
            withoutRowIds(before?.pitchBendByClipId[sourceId] ?? [])
        );
    }
    const existingIds = clips()
        .map((clip) => clip.id)
        .sort();
    expect(Object.keys(midiStore.value?.notesByClipId ?? {}).sort()).toEqual(existingIds);
    expect(Object.keys(midiStore.value?.ccByClipId ?? {}).sort()).toEqual(existingIds);
    expect(Object.keys(midiStore.value?.pitchBendByClipId ?? {}).sort()).toEqual(existingIds);
}

function expectOriginalRows(before: typeof midiStore.value): void {
    for (const clipId of ['source', 'other']) {
        expect(midiStore.value?.notesByClipId[clipId]).toEqual(before?.notesByClipId[clipId]);
        expect(midiStore.value?.ccByClipId[clipId]).toEqual(before?.ccByClipId[clipId]);
        expect(midiStore.value?.pitchBendByClipId[clipId]).toEqual(before?.pitchBendByClipId[clipId]);
    }
}

function pressDuplicate(nextBar = false): void {
    expect(
        handleKeydown({ key: 'd', mod: !nextBar, shift: false, alt: nextBar, repeat: false, keyTarget: 'workspace' })
    ).toBe(true);
}

describe('overlapping duplicate shortcut selection through real Command', () => {
    let intents: Promise<void>[] = [];
    const enqueue = duplicateIntents.enqueueClipDuplicate;

    async function settleIntents(): Promise<void> {
        await Promise.all(intents);
    }

    async function duringSnapshotWait(input: () => void, withdraw?: () => void): Promise<void> {
        const entered = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const waiting = Promise.withResolvers<void>();
        const waitForSnapshot = automergeStorage.waitForAutomergeSnapshotTransaction;
        const waitSpy = vi
            .spyOn(automergeStorage, 'waitForAutomergeSnapshotTransaction')
            .mockImplementation((transaction) => {
                waiting.resolve();
                return waitForSnapshot(transaction);
            });
        const transaction = transactSnapshot(async () => {
            entered.resolve();
            await held.promise;
        });
        await entered.promise;
        try {
            input();
            await waiting.promise;
            withdraw?.();
        } finally {
            held.resolve();
            await transaction;
            waitSpy.mockRestore();
        }
        await settleIntents();
    }

    function addSecondClip(): void {
        addClip({ id: 'other', trackId: 'track', startBeat: 4, endBeat: 9, name: 'Other notes', type: 'midi' });
        midiStore.set({
            ...midiStore.value,
            notesByClipId: {
                ...midiStore.value?.notesByClipId,
                other: [{ id: 'other-note', pitch: 72, startBeat: 2, duration: 0.5, velocity: 81, probability: 82 }],
            },
            ccByClipId: {
                ...midiStore.value?.ccByClipId,
                other: [{ id: 'other-cc', controller: 11, value: 87, beat: 1, channel: 2 }],
            },
            pitchBendByClipId: {
                ...midiStore.value?.pitchBendByClipId,
                other: [{ id: 'other-bend', value: -1500, beat: 2, channel: 2 }],
            },
        });
        automergeStorage.flushAutomergeStorageWrites();
    }

    beforeEach(() => {
        Container.clear();
        intents = [];
        vi.spyOn(duplicateIntents, 'enqueueClipDuplicate').mockImplementation((type) => {
            const intent = enqueue(type);
            intents.push(intent);
            return intent;
        });
        setCommandEventBus({ emit: async () => undefined });
        setNotificationEventBus(createEventBus<NotificationEvents>());
        automergeStorage.configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('duplicate shortcut integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'track', name: 'Keys', kind: 'midi' })],
            selectedTrackId: 'track',
        });
        addClip({ id: 'source', trackId: 'track', startBeat: 1, endBeat: 3, name: 'Notes', type: 'midi' });
        midiStore.set({
            notesByClipId: {
                source: [{ id: 'note', pitch: 60, startBeat: 0.5, duration: 1, velocity: 97, probability: 73 }],
            },
            ccByClipId: { source: [{ id: 'cc', controller: 74, value: 53, beat: 0.75, channel: 3 }] },
            pitchBendByClipId: { source: [{ id: 'bend', value: 2200, beat: 1.25, channel: 3 }] },
        });
        selectClipWithFocus('source');
        automergeStorage.flushAutomergeStorageWrites();
    });

    afterEach(() => {
        agentProjectRepairStateStore.set(null);
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        vi.restoreAllMocks();
        Container.clear();
        automergeStorage.configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each([
        {
            nextBar: false,
            expected: [
                [1, 3],
                [3, 5],
                [5, 7],
            ],
        },
        {
            nextBar: true,
            expected: [
                [1, 3],
                [4, 6],
                [8, 10],
            ],
        },
    ])(
        'chains two single-clip presses during a snapshot wait (next bar: $nextBar) and replays each press',
        async ({ nextBar, expected }) => {
            const originalMidi = structuredClone(midiStore.value);
            await duringSnapshotWait(() => {
                pressDuplicate(nextBar);
                pressDuplicate(nextBar);
            });
            expect(undoStore.value?.past).toHaveLength(2);
            expect(clipSelectionStore.value?.selectedClipId).toBe(clips()[2]?.id);
            expect(clips().map(({ startBeat, endBeat }) => [startBeat, endBeat])).toEqual(expected);
            expectRawMatchesProjection();
            expectOriginalRows(originalMidi);
            expectSurvivingMidi(['source'], originalMidi);
            const finalGeometry = geometry();
            const finalMidi = musicalContent();
            for (const clip of clips()) {
                expect(midiStore.value?.notesByClipId[clip.id]).toEqual([
                    expect.objectContaining({ pitch: 60, startBeat: 0.5, duration: 1, velocity: 97 }),
                ]);
            }
            await undo();
            expect(geometry()).toEqual(finalGeometry.slice(0, 2));
            expectRawMatchesProjection();
            expectOriginalRows(originalMidi);
            expectSurvivingMidi(['source'], originalMidi);
            await undo();
            expect(geometry()).toEqual(finalGeometry.slice(0, 1));
            expectRawMatchesProjection();
            expectOriginalRows(originalMidi);
            expectSurvivingMidi(['source'], originalMidi);
            await redo();
            expect(geometry()).toEqual(finalGeometry.slice(0, 2));
            await redo();
            expect(geometry()).toEqual(finalGeometry);
            expect(musicalContent()).toEqual(finalMidi);
            expectRawMatchesProjection();
            expectOriginalRows(originalMidi);
            expectSurvivingMidi(['source'], originalMidi);
            await undo();
            expect(geometry()).toEqual(finalGeometry.slice(0, 2));
            expectRawMatchesProjection();
            expectOriginalRows(originalMidi);
            expectSurvivingMidi(['source'], originalMidi);
        }
    );

    it.each([false, true])(
        'chains unequal multi-clip spans and keeps notes and one undo group per press (ignored next-bar: %s)',
        async (ignoredNextBar) => {
            addSecondClip();
            setClipSelection(['source', 'other']);
            const originalMidi = structuredClone(midiStore.value);
            await duringSnapshotWait(() => {
                pressDuplicate();
                if (ignoredNextBar) {
                    pressDuplicate(true);
                }
                pressDuplicate();
            });
            expect(clips().map(({ startBeat, endBeat }) => [startBeat, endBeat])).toEqual([
                [1, 3],
                [4, 9],
                [9, 11],
                [12, 17],
                [17, 19],
                [20, 25],
            ]);
            expect(clipSelectionStore.value?.selectedClipIds).toEqual(
                clips()
                    .slice(4)
                    .map((clip) => clip.id)
            );
            const entries = captureUndoHistory().past;
            expect(entries).toHaveLength(4);
            expect(entries[0]?.groupId).toBe(entries[1]?.groupId);
            expect(entries[2]?.groupId).toBe(entries[3]?.groupId);
            expect(entries[0]?.groupId).not.toBe(entries[2]?.groupId);
            const finalGeometry = geometry();
            const finalMidi = musicalContent();
            expectRawMatchesProjection();
            expectOriginalRows(originalMidi);
            expectSurvivingMidi(['source', 'other'], originalMidi);
            expect(clips().map((clip) => midiStore.value?.notesByClipId[clip.id]?.[0]?.pitch)).toEqual([
                60, 72, 60, 72, 60, 72,
            ]);
            await undo();
            expect(geometry()).toEqual(finalGeometry.slice(0, 4));
            expectRawMatchesProjection();
            expectOriginalRows(originalMidi);
            expectSurvivingMidi(['source', 'other'], originalMidi);
            await undo();
            expect(geometry()).toEqual(finalGeometry.slice(0, 2));
            expectRawMatchesProjection();
            expectOriginalRows(originalMidi);
            expectSurvivingMidi(['source', 'other'], originalMidi);
            await redo();
            expect(geometry()).toEqual(finalGeometry.slice(0, 4));
            await redo();
            expect(geometry()).toEqual(finalGeometry);
            expect(musicalContent()).toEqual(finalMidi);
            expectRawMatchesProjection();
            expectOriginalRows(originalMidi);
            expectSurvivingMidi(['source', 'other'], originalMidi);
            await undo();
            expect(geometry()).toEqual(finalGeometry.slice(0, 4));
            expectRawMatchesProjection();
            expectOriginalRows(originalMidi);
            expectSurvivingMidi(['source', 'other'], originalMidi);
        }
    );

    it.each([false, true])(
        'retires work after an explicit selection change, including coalesced away-and-back (%s)',
        async (awayAndBack) => {
            addSecondClip();
            const before = projectSnapshot();
            await duringSnapshotWait(
                () => {
                    pressDuplicate();
                    pressDuplicate();
                },
                () => {
                    batchStoreUpdates(() => {
                        selectClipWithFocus('other');
                        if (awayAndBack) {
                            selectClipWithFocus('source');
                        }
                    });
                }
            );
            expect(clips()).toHaveLength(2);
            expect(projectSnapshot()).toBe(before);
            expect(undoStore.value?.past).toHaveLength(0);
            expect(clipSelectionStore.value?.selectedClipId).toBe(awayAndBack ? 'source' : 'other');
            expectRawMatchesProjection();
            pressDuplicate();
            await settleIntents();
            expect(clips()).toHaveLength(3);
            expect(clips()[2]).toMatchObject(
                awayAndBack ? { startBeat: 3, endBeat: 5 } : { startBeat: 9, endBeat: 14 }
            );
            expect(clipSelectionStore.value?.selectedClipId).toBe(clips()[2]?.id);
        }
    );

    it.each([false, true])(
        'admits fresh input on a changed selection while an older chain is waiting (multi: %s)',
        async (multi) => {
            addSecondClip();
            if (multi) {
                setClipSelection(['source', 'other']);
            }
            await duringSnapshotWait(
                () => {
                    pressDuplicate();
                    pressDuplicate();
                },
                () => {
                    selectClipWithFocus('other');
                    pressDuplicate();
                }
            );
            expect(clips()).toHaveLength(3);
            expect(clips()[2]).toMatchObject({ startBeat: 9, endBeat: 14 });
            expect(clipSelectionStore.value?.selectedClipId).toBe(clips()[2]?.id);
            expect(undoStore.value?.past).toHaveLength(1);
            expectRawMatchesProjection();
        }
    );

    it.each([false, true])(
        'retires a real admission refusal, preserves its warning and recovers on fresh input (multi: %s)',
        async (multi) => {
            if (multi) {
                addSecondClip();
                setClipSelection(['source', 'other']);
            }
            const notify = vi.spyOn(await import('#/utils/Notification/notifyUser'), 'notifyUser');
            agentProjectRepairStateStore.set({
                status: 'repair-required',
                audioGraphValid: true,
                detectedRevision: 'fixture-revision',
                inspectionAvailable: true,
                projectInvariantsValid: false,
                rawProjectRetained: true,
                repairCandidates: [],
            });
            pressDuplicate();
            pressDuplicate();
            await settleIntents();
            expect(clips()).toHaveLength(multi ? 2 : 1);
            expect(undoStore.value?.past).toHaveLength(0);
            expect(notify).toHaveBeenCalledWith(expect.stringContaining('repair'), 'warning');
            expectRawMatchesProjection();
            agentProjectRepairStateStore.set(null);
            pressDuplicate();
            await settleIntents();
            expect(clips()).toHaveLength(multi ? 4 : 2);
            expectRawMatchesProjection();
        }
    );

    it.each([false, true])(
        'does not mutate a replacement project reusing clip IDs (multi: %s), and fresh input works',
        async (multi) => {
            addSecondClip();
            if (multi) {
                setClipSelection(['source', 'other']);
            }
            await duringSnapshotWait(
                () => {
                    pressDuplicate();
                    pressDuplicate();
                },
                () => {
                    removeCrdtDoc('root');
                    createCrdtDoc('root');
                    setTrackStoreState({
                        ...defaultTrackState,
                        tracks: [createTrack({ id: 'track', name: 'Replacement', kind: 'midi' })],
                        selectedTrackId: 'track',
                    });
                    addClip({
                        id: 'source',
                        trackId: 'track',
                        startBeat: 20,
                        endBeat: 23,
                        name: 'Replacement source',
                        type: 'midi',
                    });
                    midiStore.set({
                        notesByClipId: {
                            source: [{ id: 'replacement-note', pitch: 81, startBeat: 0, duration: 1, velocity: 99 }],
                        },
                        ccByClipId: {},
                        pitchBendByClipId: {},
                    });
                    selectClipWithFocus('source');
                    automergeStorage.flushAutomergeStorageWrites();
                }
            );
            expect(clips()).toHaveLength(1);
            expect(clips()[0]).toMatchObject({ id: 'source', name: 'Replacement source', startBeat: 20, endBeat: 23 });
            expect(clipSelectionStore.value?.selectedClipId).toBe('source');
            expect(undoStore.value?.past).toHaveLength(0);
            expectRawMatchesProjection();
            pressDuplicate();
            await settleIntents();
            expect(clips()).toHaveLength(2);
            expect(clips()[1]).toMatchObject({ startBeat: 23, endBeat: 26 });
            expect(midiStore.value?.notesByClipId[clips()[1]!.id]?.[0]?.pitch).toBe(81);
            expectRawMatchesProjection();
        }
    );

    it.each([false, true])(
        'retires old work on a real replacement retaining the same selection reference (multi: %s)',
        async (multi) => {
            if (multi) {
                addSecondClip();
                setClipSelection(['source', 'other']);
            }
            const selection = clipSelectionStore.value;
            const projectIdentity = captureProjectIdentity();
            let replacement:
                | {
                      raw: string | undefined;
                      geometry: ReturnType<typeof geometry>;
                      midi: typeof midiStore.value;
                  }
                | undefined;
            await duringSnapshotWait(
                () => {
                    pressDuplicate();
                    pressDuplicate();
                },
                () => {
                    removeCrdtDoc('root');
                    createCrdtDoc('root');
                    setTrackStoreState({
                        ...defaultTrackState,
                        tracks: [createTrack({ id: 'track', name: 'Replacement', kind: 'midi' })],
                        selectedTrackId: 'track',
                    });
                    addClip({
                        id: 'source',
                        trackId: 'track',
                        startBeat: 20,
                        endBeat: 23,
                        name: 'New source',
                        type: 'midi',
                    });
                    midiStore.set({
                        notesByClipId: {
                            source: [
                                {
                                    id: 'new-note',
                                    pitch: 81,
                                    startBeat: 0.25,
                                    duration: 1.5,
                                    velocity: 99,
                                    probability: 63,
                                },
                            ],
                        },
                        ccByClipId: { source: [{ id: 'new-cc', controller: 74, value: 92, beat: 0.5, channel: 1 }] },
                        pitchBendByClipId: { source: [{ id: 'new-bend', value: 900, beat: 1, channel: 1 }] },
                    });
                    if (multi) {
                        addClip({
                            id: 'other',
                            trackId: 'track',
                            startBeat: 27,
                            endBeat: 32,
                            name: 'New other',
                            type: 'midi',
                        });
                        midiStore.set({
                            ...midiStore.value,
                            notesByClipId: {
                                ...midiStore.value?.notesByClipId,
                                other: [
                                    {
                                        id: 'new-other-note',
                                        pitch: 54,
                                        startBeat: 1,
                                        duration: 2,
                                        velocity: 86,
                                        probability: 78,
                                    },
                                ],
                            },
                            ccByClipId: {
                                ...midiStore.value?.ccByClipId,
                                other: [{ id: 'new-other-cc', controller: 11, value: 41, beat: 1.5, channel: 4 }],
                            },
                            pitchBendByClipId: {
                                ...midiStore.value?.pitchBendByClipId,
                                other: [{ id: 'new-other-bend', value: -2400, beat: 2, channel: 4 }],
                            },
                        });
                    }
                    automergeStorage.flushAutomergeStorageWrites();
                    expect(captureProjectIdentity()).not.toBe(projectIdentity);
                    expect(clipSelectionStore.value).toBe(selection);
                    const existingIds = clips().map((clip) => clip.id);
                    expect(selection?.selectedClipIds.every((id) => existingIds.includes(id))).toBe(true);
                    replacement = {
                        raw: projectSnapshot(),
                        geometry: geometry(),
                        midi: structuredClone(midiStore.value),
                    };
                }
            );
            if (!replacement) {
                throw new Error('Expected the real replacement fixture to complete before releasing queued work');
            }
            expect(projectSnapshot()).toBe(replacement.raw);
            expect(geometry()).toEqual(replacement.geometry);
            expect(midiStore.value).toEqual(replacement.midi);
            expect(clipSelectionStore.value).toBe(selection);
            expect(captureUndoHistory()).toMatchObject({ past: [], future: [] });
            expectRawMatchesProjection();

            pressDuplicate();
            await settleIntents();
            const sourceIds = ['source'];
            let expectedGeometry = [
                [20, 23],
                [23, 26],
            ];
            if (multi) {
                sourceIds.push('other');
                expectedGeometry = [
                    [20, 23],
                    [27, 32],
                    [32, 35],
                    [39, 44],
                ];
            }
            expect(clips().map(({ startBeat, endBeat }) => [startBeat, endBeat])).toEqual(expectedGeometry);
            expect(clipSelectionStore.value?.selectedClipIds).toEqual(
                clips()
                    .slice(sourceIds.length)
                    .map((clip) => clip.id)
            );
            expect(captureUndoHistory().past).toHaveLength(sourceIds.length);
            expectOriginalRows(replacement.midi);
            expectSurvivingMidi(sourceIds, replacement.midi);
            expectRawMatchesProjection();
        }
    );

    it.each(['duplicateClip', 'duplicateClipToNextBar', 'duplicateClipAt'] as const)(
        'withdraws %s publication after the real handler stages its writes',
        async (type) => {
            addSecondClip();
            if (type === 'duplicateClipAt') {
                setClipSelection(['source', 'other']);
            }
            const before = projectSnapshot();
            const handlers = getArrangementHandlers();
            const entered = Promise.withResolvers<void>();
            const held = Promise.withResolvers<void>();
            function hold<TAction extends AppAction>(handler: ActionHandler<TAction>): ActionHandler<TAction> {
                return {
                    ...handler,
                    // The async barrier cannot certify synchronous isolated-project preview.
                    previewExecution: undefined,
                    execute: async (action, context) => {
                        const result = handler.execute(action, context);
                        entered.resolve();
                        await held.promise;
                        return result;
                    },
                };
            }
            clearHandlerRegistry();
            switch (type) {
                case 'duplicateClip':
                    registerHandlerMap({ ...handlers, duplicateClip: hold(handlers.duplicateClip) });
                    break;
                case 'duplicateClipToNextBar':
                    registerHandlerMap({ ...handlers, duplicateClipToNextBar: hold(handlers.duplicateClipToNextBar) });
                    break;
                case 'duplicateClipAt':
                    registerHandlerMap({ ...handlers, duplicateClipAt: hold(handlers.duplicateClipAt) });
                    break;
            }
            try {
                pressDuplicate(type === 'duplicateClipToNextBar');
                await entered.promise;
                selectClipWithFocus('other');
            } finally {
                held.resolve();
            }
            await settleIntents();
            expect(clips()).toHaveLength(2);
            expect(projectSnapshot()).toBe(before);
            expect(clipSelectionStore.value?.selectedClipId).toBe('other');
            expect(undoStore.value?.past).toHaveLength(0);
            expectRawMatchesProjection();
        }
    );
});
