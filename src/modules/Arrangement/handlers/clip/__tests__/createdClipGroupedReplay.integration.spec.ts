import { change, clone, getHeads, load, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    projectCrdtToStores,
    replaceCrdtDoc,
    replaceCrdtDocInLineage,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { type AppAction, type HandlerExecutionResult } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { setAllEnvelopes, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { trackStore } from '../../../stores/trackStore';
import { warpStates } from '../../../stores/warpStates';
import { setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

registerDeviceEnginePorts();
registerProjectSlotProjections();

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function content() {
    flushAutomergeStorageWrites();
    const document = getCrdtDoc<{ tracks: unknown; midi: unknown; gainEnvelopes: unknown; automation: unknown }>(
        'root'
    );
    return structuredClone({
        raw: document && {
            tracks: document.tracks,
            midi: document.midi,
            gainEnvelopes: document.gainEnvelopes,
            automation: document.automation,
        },
        tracks: trackStore.value,
        midi: midiStore.value,
        automation: automationStore.value,
    });
}

function creator(type: 'addClip' | 'duplicateClip' | 'duplicateClipAt' | 'duplicateClipToNextBar'): AppAction {
    if (type === 'addClip') {
        return {
            type,
            payload: { id: 'copy', trackId: 'track-1', startBeat: 4, endBeat: 8, name: 'Created', type: 'midi' },
        };
    }
    if (type === 'duplicateClipAt') {
        return {
            type,
            payload: { clipId: 'source', targetClipId: 'copy', destinationTrackId: 'track-1', startBeat: 4 },
        };
    }
    return { type, payload: { clipId: 'source', targetClipId: 'copy' } };
}

describe('created clip replay preserves its own action prefix', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('created clip replay prefix');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        sessionStorage.removeItem('sourdaw-undo-session');
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        setArrangementEventBus({ emit: async () => undefined });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const { audioBufferId: _buffer, ...source } = ClipDummy.create({
            id: 'source',
            trackId: 'track-1',
            startBeat: 0,
            endBeat: 4,
            type: 'midi',
        });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-1', kind: 'midi', clips: [source], devices: [] })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: { source: [{ id: 'source-note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        automationStore.set({
            lanes: [
                {
                    id: 'source-lane',
                    trackId: 'track-1',
                    clipId: 'source',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });
        setAllEnvelopes({});
        setEnvelope('source', { clipId: 'source', enabled: true, points: [{ id: 'gain', beatOffset: 0, gainDb: -6 }] });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setAllEnvelopes({});
        warpStates.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(['addClip', 'duplicateClip', 'duplicateClipAt', 'duplicateClipToNextBar'] as const)(
        '%s keeps repeated replay with MIDI and satellite ownership',
        async (type) => {
            const before = content();
            await executeAppAction(creator(type));
            const created = content();
            expect(trackStore.value?.tracks[0]?.clips.some((clip) => clip.id === 'copy')).toBe(true);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expect((await undo()).headConsumed).toBe(true);
            expect(content()).toEqual(before);
            await redo();
            expect(trackStore.value?.tracks[0]?.clips.find((clip) => clip.id === 'copy')).toEqual(
                created.tracks?.tracks[0]?.clips.find((clip) => clip.id === 'copy')
            );
            expect(midiStore.value?.notesByClipId.copy?.map(({ id: _id, ...note }) => note)).toEqual(
                created.midi?.notesByClipId.copy?.map(({ id: _id, ...note }) => note)
            );
            expect((await undo()).headConsumed).toBe(true);
            expect(content()).toEqual(before);
        }
    );

    it.each([false, true])(
        'addClip preserves its prefix before later grouped notes (hydrated=%s)',
        async (hydrated) => {
            const before = content();
            expect(
                await executeAppActionBatch(
                    [
                        creator('addClip'),
                        {
                            type: 'addNotes',
                            payload: {
                                clipId: 'copy',
                                notes: [{ id: 'later', pitch: 67, startBeat: 2, duration: 1, velocity: 90 }],
                            },
                        },
                    ],
                    { requireCompensation: true, groupId: 'creation-notes' }
                )
            ).toMatchObject({ status: 'committed' });
            const created = content();
            expect(midiStore.value?.notesByClipId.copy?.some((note) => note.id === 'later')).toBe(true);
            expect((await undo()).headConsumed).toBe(true);
            expect(content()).toEqual(before);
            if (hydrated) {
                await vi.waitFor(() => {
                    const mirror = JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}') as {
                        past?: unknown[];
                        future?: unknown[];
                    };
                    expect(mirror.past).toHaveLength(0);
                    expect(mirror.future).toHaveLength(2);
                });
                const outgoing = undoHistoryStore.value!.future;
                clearHandlerRegistry();
                registerProductionCommandHandlers(
                    getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })
                );
                expect(undoHistoryStore.value?.future).toHaveLength(2);
                expect(undoHistoryStore.value!.future[0]).not.toBe(outgoing[0]);
                if (outgoing[0]?.kind === 'action' && undoHistoryStore.value!.future[0]?.kind === 'action') {
                    expect(undoHistoryStore.value!.future[0].inverseAction).not.toBe(outgoing[0].inverseAction);
                    expect(undoHistoryStore.value!.future[0].action).not.toBe(outgoing[0].action);
                } else {
                    throw new Error('Expected hydrated action entries');
                }
            }
            await redo();
            expect(content()).toEqual(created);
            expect((await undo()).headConsumed).toBe(true);
            expect(content()).toEqual(before);
        }
    );

    async function reloadHistory(side: 'past' | 'future', count: number) {
        await vi.waitFor(() => {
            const mirror = JSON.parse(sessionStorage.getItem('sourdaw-undo-session') ?? '{}') as {
                past?: unknown[];
                future?: unknown[];
            };
            expect(mirror[side]).toHaveLength(count);
        });
        flushAutomergeStorageWrites();
        replaceCrdtDocInLineage({ id: 'root', doc: load(save(getCrdtDoc('root')!)) });
        projectCrdtToStores({ resetProjections: true });
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        expect(undoHistoryStore.value?.[side]).toHaveLength(count);
    }

    async function duplicateThenRemove(durableSibling: boolean) {
        const options = { groupId: 'duplicate-remove', groupLabel: 'Duplicate then remove' };
        await executeAppAction(creator('duplicateClipAt'), options);
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'copy', ripple: false } }, options);
        if (durableSibling) {
            await executeAppAction({ type: 'renameTrack', payload: { trackId: 'track-1', name: 'Renamed' } }, options);
        }
    }

    it.each([false, true])(
        'keeps saved duplicate/remove captures paired through repeated replay (durable sibling=%s)',
        async (durableSibling) => {
            trackStore.set({ ...trackStore.value!, selectedTrackId: null });
            const before = content();
            await duplicateThenRemove(durableSibling);
            const after = content();
            const count = durableSibling ? 3 : 2;
            await reloadHistory('past', count);
            expect((await undo()).headConsumed).toBe(true);
            expect(content()).toEqual(before);
            await reloadHistory('future', count);
            await redo();
            expect(content()).toEqual(after);
            await reloadHistory('past', count);
            expect((await undo()).headConsumed).toBe(true);
            expect(content()).toEqual(before);
            await reloadHistory('future', count);
            await redo();
            expect(content()).toEqual(after);
        }
    );

    it('keeps both duplicate/remove captures when a committed observer changes their source', async () => {
        await duplicateThenRemove(true);
        await undo();
        await reloadHistory('future', 3);
        const entries = undoHistoryStore.value!.future;
        const previous = entries.map((entry) =>
            entry.kind === 'action' ? structuredClone(entry.inverseAction) : null
        );
        const actions = entries.map((entry) => {
            if (entry.kind !== 'action') {
                throw new Error('Expected saved duplicate/remove actions');
            }
            return entry.redoAction ?? entry.action;
        });
        const rename = getArrangementHandlers().renameTrack;
        const originalExecute = rename.execute;
        const observer = vi
            .spyOn(rename, 'execute')
            .mockImplementation((action, context): void | HandlerExecutionResult => {
                const effect = originalExecute(action, context);
                if (effect instanceof Promise) {
                    throw new TypeError('Expected a synchronous rename handler');
                }
                if (!effect || effect.status !== 'written') {
                    return effect;
                }
                if (effect.afterRuntimeExecution !== undefined) {
                    throw new TypeError('Expected project commit effects from rename');
                }
                return {
                    ...effect,
                    status: 'written',
                    afterCommit: async () => {
                        await effect.afterCommit?.();
                        type Root = { midi: NonNullable<typeof midiStore.value> };
                        replaceCrdtDoc({
                            id: 'root',
                            doc: change(clone(getCrdtDoc<Root>('root')!), (document) => {
                                document.midi.notesByClipId.source![0]!.velocity = 42;
                            }),
                        });
                        projectCrdtToStores();
                    },
                    afterAmbiguousCommit: async () => {
                        await effect.afterAmbiguousCommit?.();
                    },
                };
            });
        let result;
        try {
            result = await executeAppActionBatch(actions, { skipUndo: true });
        } finally {
            observer.mockRestore();
        }
        expect(result.status).toBe('committed');
        expect(midiStore.value?.notesByClipId.source?.[0]?.velocity).toBe(42);
        expect(entries.map((entry) => (entry.kind === 'action' ? entry.inverseAction : null))).toEqual(previous);
    });

    it('keeps every paired creator/removal capture after an ambiguous group publication', async () => {
        await duplicateThenRemove(true);
        await undo();
        await reloadHistory('future', 3);
        const entries = undoHistoryStore.value!.future;
        const previous = entries.map((entry) =>
            entry.kind === 'action' ? structuredClone(entry.inverseAction) : null
        );
        const actions = entries.map((entry) => {
            if (entry.kind !== 'action') {
                throw new Error('Expected saved duplicate/remove actions');
            }
            return entry.redoAction ?? entry.action;
        });
        let failAfterPublication = true;
        configureAutomergeStoragePort({
            getDoc: (docId) => getCrdtDoc<Record<string, unknown>>(docId),
            getDocHeads: (docId) => getHeads(getCrdtDoc(docId)!),
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => getCrdtDoc(docId) !== undefined,
            mutateDoc: ({ docId, changeFn, message, changedKeys, snapshotTransaction }) => {
                mutateCrdtDoc({ id: docId, changeFn, message, localSlots: changedKeys, snapshotTransaction });
                if (failAfterPublication) {
                    failAfterPublication = false;
                    throw new Error('Controlled failure after grouped creator/removal publication');
                }
            },
        });
        try {
            const result = await executeAppActionBatch(actions, { skipUndo: true });
            expect(result.status).toBe('ambiguous');
            expect(trackStore.value?.tracks[0]?.name).toBe('Renamed');
            expect(trackStore.value?.tracks[0]?.clips.some((clip) => clip.id === 'copy')).toBe(false);
            expect(entries.map((entry) => (entry.kind === 'action' ? entry.inverseAction : null))).toEqual(previous);
        } finally {
            registerCrdtStorageRuntime();
        }
    });

    it('does not publish a fresh creator guard when a grouped replay rolls back', async () => {
        await executeAppActionBatch(
            [
                creator('addClip'),
                {
                    type: 'addNotes',
                    payload: {
                        clipId: 'copy',
                        notes: [{ id: 'later', pitch: 67, startBeat: 2, duration: 1, velocity: 90 }],
                    },
                },
            ],
            { groupId: 'failed-publication', requireCompensation: true }
        );
        await undo();
        const before = content();
        const history = structuredClone(undoHistoryStore.value);
        const handler = getMidiNoteTransformHandlers().restoreMidiClipNotes;
        let staged = false;
        clearHandlerRegistry();
        registerHandlerMap({
            ...getArrangementHandlers(),
            ...getMidiNoteTransformHandlers(),
            restoreMidiClipNotes: {
                ...handler,
                execute: (action, context) => {
                    handler.execute(action, context);
                    staged = true;
                    return { status: 'conflict' };
                },
            },
        });
        await redo();
        expect(staged).toBe(true);
        expect(content()).toEqual(before);
        expect(undoHistoryStore.value).toEqual(history);
    });

    it.each(['addClip', 'duplicateClip', 'duplicateClipToNextBar'] as const)(
        '%s leaves its paired guard and history unchanged after an ambiguous publication',
        async (type) => {
            await executeAppAction(creator(type));
            await undo();
            const entry = undoHistoryStore.value?.future[0];
            if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'discardDuplicatedClip') {
                throw new Error('Expected the pending creator inverse');
            }
            const inverse = entry.inverseAction;
            const guard = inverse.payload.generatedMidiStateGuard;
            const previousInverse = structuredClone(inverse);
            const history = structuredClone(undoHistoryStore.value);
            const execution = vi.spyOn(getArrangementHandlers()[type], 'execute');
            const onCommitted = vi.fn();
            const onAmbiguousCommit = vi.fn();
            macroStore.set({ macros: [], recording: true, currentRecording: [] });
            let throwAfterPublication = true;
            configureAutomergeStoragePort({
                getDoc: (docId) => getCrdtDoc<Record<string, unknown>>(docId),
                getDocHeads: (docId) => getHeads(getCrdtDoc(docId)!),
                getSemanticMessage: () => undefined,
                hasDoc: (docId) => getCrdtDoc(docId) !== undefined,
                mutateDoc: ({ docId, changeFn, message, changedKeys, snapshotTransaction }) => {
                    mutateCrdtDoc({ id: docId, changeFn, message, localSlots: changedKeys, snapshotTransaction });
                    if (throwAfterPublication) {
                        throwAfterPublication = false;
                        throw new Error('Controlled failure after creator publication');
                    }
                },
            });
            try {
                const result = await executeAppActionBatch([entry.redoAction ?? entry.action], {
                    skipUndo: true,
                    onCommitted,
                    onAmbiguousCommit,
                });
                expect(result.status).toBe('ambiguous');
                expect(onAmbiguousCommit).toHaveBeenCalledOnce();
                expect(onCommitted).not.toHaveBeenCalled();
                expect(execution).toHaveBeenCalledOnce();
                const effects = await execution.mock.results[0]?.value;
                expect(effects?.afterAmbiguousCommit).toBeTypeOf('function');
                expect(inverse.payload.generatedMidiStateGuard).toBe(guard);
                expect(inverse).toEqual(previousInverse);
                expect(undoHistoryStore.value).toEqual(history);
                expect(macroStore.value?.currentRecording).toEqual([]);
                expect(
                    getCrdtDoc<{ tracks: NonNullable<typeof trackStore.value> }>('root')?.tracks.tracks[0]?.clips.some(
                        (clip) => clip.id === 'copy'
                    )
                ).toBe(true);
            } finally {
                execution.mockRestore();
                registerCrdtStorageRuntime();
            }
        }
    );
});
