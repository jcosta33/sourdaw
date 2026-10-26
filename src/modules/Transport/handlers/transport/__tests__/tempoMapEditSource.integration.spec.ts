import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    AutomergeStorageWriteConflictError,
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { sanitizeTrackSnapshot, type Clip, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, normalizeTrack, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore, undoStore } from '#/modules/Command/stores';
import {
    captureCommandTargetFingerprints,
    clearUndoHistory,
    commandBatchPreflightPort,
    commandBatchPreviewPort,
    commandProjectRevisionPort,
    compileVersionedCommandBatchEnvelope,
    executeAppAction,
    executeVersionedCommandBatchEnvelope,
    getExecutableAppActionToolSchemas,
    getExecutableCommandRegistrations,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    isAppActionConflictError,
    redo,
    registerProductionCommandHandlers,
    serializeVersionedCommandEnvelope,
    undo,
} from '#/modules/Command/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import {
    createCrdtDoc,
    captureProjectRevision,
    createCommandPreviewWorkspace,
    getCrdtDoc,
    mutateCrdtDoc,
    getDrumPreviewBranchHandlers,
    projectCrdtToStores,
    replaceCrdtDocInLineage,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { hasValidAudioSourceState, projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import { type AppAction, type HandlerCommitValidation } from '#/utils/handlerContract';
import {
    setNotificationEventBus,
    type NotifyPayload,
    type ConfirmPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { readSecondsAtBeat } from '../../../stores/readSecondsAtBeat';
import { readTempoAtBeat } from '../../../stores/readTempoAtBeat';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { defaultTransportState, transportStore } from '../../../stores/transportStore';
import { getTransportHandlers } from '../../../useCases/getTransportHandlers';

function clip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'source',
        trackId: 'audio',
        name: 'Distinct bursts',
        type: 'audio',
        startBeat: 0,
        endBeat: 12,
        audioBufferId: 'bursts',
        audioOffsetBeats: 8,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function installClip(source: Clip): void {
    trackStore.set({
        tracks: [normalizeTrack({ id: 'audio', name: 'Audio', kind: 'audio', clips: [source] })],
        selectedTrackId: 'audio',
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
}

function registerProductionTempoHandlers(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers([
        getArrangementHandlers(),
        getAudioRenderingHandlers(),
        getAutomationHandlers(),
        getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
        getMidiNoteTransformHandlers(),
        getTransportHandlers(),
        getYeastHandlers(),
    ]);
}

function sourceEntries(clips = trackStore.value!.tracks[0]!.clips): number[] {
    return resolveClipsWithComping('audio', clips).map((source) => {
        const segment = projectAudioLoopPassSegments({
            clip: source,
            loopLengthBeats: source.loopLength ?? source.endBeat - source.startBeat,
            iterationStartBeat: source.startBeat,
            iterationEndBeat: source.endBeat,
            stretchRatio: source.stretchMode && source.stretchMode !== 'off' ? (source.stretchRatio ?? 1) : 1,
            tempoAtClipStart: readTempoAtBeat({ beat: source.startBeat }),
            secondsAtBeat: (beat) => readSecondsAtBeat({ beat }),
        })[0];
        if (!segment) {
            throw new Error('Expected an actual audible source segment');
        }
        return segment.sourceStartSeconds;
    });
}

function authority(): void {
    flushAutomergeStorageWrites();
    const document = getCrdtDoc('root');
    if (!document) {
        throw new Error('Expected the authoritative project');
    }
    const project = Automerge.toJS(document);
    // The owning track adapter writes `{ tracks }` through createAutomergeStorage's JSON-safe projection.
    expect(project.tracks).toEqual({ tracks: trackStore.value!.tracks });
    expect(project).toMatchObject({
        takeLanes: takeLaneStore.value,
        transport: { tempo: transportStore.value!.tempo },
        tempoMap: tempoMapStore.value,
    });
}

function bindCommitGuard(
    transaction: Pick<ReturnType<typeof runWithAutomergeStorageTransaction>, 'validateCommit' | 'validateDocument'>,
    guard: HandlerCommitValidation
): void {
    transaction.validateCommit(() => {
        const reason = guard.beforeCommit();
        if (reason) {
            throw new AutomergeStorageWriteConflictError(reason);
        }
        return null;
    });
    transaction.validateDocument(guard.documentId, (document) => {
        const reason = guard.validateDocument(document);
        if (reason) {
            throw new AutomergeStorageWriteConflictError(reason);
        }
        return null;
    });
}

describe('tempo edits preserve the physical audio programme', () => {
    beforeEach(() => {
        Container.clear();
        setNotificationEventBus(
            createEventBus<{ 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload }>()
        );
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('tempo source promotion');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        transportStore.set({ ...defaultTransportState, tempo: 120, playheadPosition: 0 });
        tempoMapStore.set({ changes: [] });
        takeLaneStore.set({ lanes: [] });
        installClip(clip());
    });

    afterEach(() => {
        commandBatchPreflightPort.setProvider(null);
        commandBatchPreviewPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        clearUndoHistory();
        clearHandlerRegistry();
        takeLaneStore.set({ lanes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        tempoMapStore.set({ changes: [] });
        transportStore.set(structuredClone(defaultTransportState));
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it('captures a live legacy entry under the old map and restores exact absence through real Undo/Redo', async () => {
        const before = structuredClone(trackStore.value);
        expect(sourceEntries()).toEqual([4]);
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });

        expect(sourceEntries()).toEqual([4]);
        expect(trackStore.value!.tracks[0]!.clips[0]).toMatchObject({
            audioOffsetSeconds: 4,
            audioUnwrappedOffsetSeconds: 4,
        });
        authority();
        const after = structuredClone(trackStore.value);
        expect(undoStore.value?.past).toHaveLength(1);

        await undo();
        expect(transportStore.value?.tempo).toBe(120);
        expect(trackStore.value).toEqual(before);
        authority();
        await redo();
        expect(transportStore.value?.tempo).toBe(240);
        expect(trackStore.value).toEqual(after);
        expect(sourceEntries()).toEqual([4]);
        authority();
    });

    it('captures the actual selected-region and base-gap entries before a stretched loop changes tempo', async () => {
        installClip(clip({ loopEnabled: true, loopLength: 4, stretchMode: 'timestretch', stretchRatio: 2 }));
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane',
                    trackId: 'audio',
                    takes: [
                        {
                            id: 'selected',
                            clipId: 'source',
                            name: 'Selected',
                            startBeat: 0,
                            endBeat: 12,
                            selected: true,
                            sourceOffsetBeats: 4,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 1, endBeat: 11, takeId: 'selected' }],
                },
            ],
        });
        const before = sourceEntries();
        expect(before).toEqual([4, 6.5, 9.5]);
        authority();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });

        expect(sourceEntries()).toEqual(before);
        authority();
    });

    it('refuses Undo after a peer changes the owned source inputs without consuming history or writing', async () => {
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });
        const current = trackStore.value!;
        trackStore.set({
            ...current,
            tracks: current.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((source) => ({ ...source, audioOffsetBeats: 10 })),
            })),
        });
        authority();
        const before = getCrdtDoc('root');
        const history = structuredClone(undoHistoryStore.value);
        expect((await undo()).headConsumed).toBe(false);
        expect(getCrdtDoc('root')).toBe(before);
        expect(undoHistoryStore.value).toEqual(history);
        expect(transportStore.value?.tempo).toBe(240);
        authority();
    });

    it('retains captured Redo source guards after clean Undo instead of capturing a peer edit afresh', async () => {
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });
        expect((await undo()).headConsumed).toBe(true);
        const current = trackStore.value!;
        trackStore.set({
            ...current,
            tracks: current.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((source) => ({ ...source, audioOffsetBeats: 10 })),
            })),
        });
        authority();
        expect(sourceEntries()).toEqual([5]);
        const before = getCrdtDoc('root');
        const history = structuredClone(undoHistoryStore.value);
        await redo();
        expect(getCrdtDoc('root')).toBe(before);
        expect(undoHistoryStore.value).toEqual(history);
        expect(transportStore.value?.tempo).toBe(120);
        expect(sourceEntries()).toEqual([5]);
        authority();
    });

    it('preserves unrelated peer track and clip edits across bounded Undo and Redo', async () => {
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });
        const current = trackStore.value!;
        trackStore.set({
            ...current,
            tracks: current.tracks.map((track) => ({
                ...track,
                name: 'Peer name',
                clips: track.clips.map((source) => ({ ...source, gain: 0.4 })),
            })),
        });
        authority();
        expect((await undo()).headConsumed).toBe(true);
        expect(trackStore.value?.tracks[0]).toMatchObject({ name: 'Peer name', clips: [{ gain: 0.4 }] });
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        expect(sourceEntries()).toEqual([4]);
        await redo();
        expect(trackStore.value?.tracks[0]).toMatchObject({
            name: 'Peer name',
            clips: [{ gain: 0.4, audioOffsetSeconds: 4 }],
        });
        expect(sourceEntries()).toEqual([4]);
        authority();
    });

    it('discards a copied and coherently changed caller JSON source plan before registered execution', async () => {
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });
        const entry = undoHistoryStore.value?.past.at(-1);
        if (
            entry?.kind !== 'action' ||
            entry.action.type !== 'setTempo' ||
            !entry.action.payload.audioSourcePromotion
        ) {
            throw new Error('Expected the real materialized tempo capture');
        }
        const promotion = structuredClone(entry.action.payload.audioSourcePromotion);
        expect((await undo()).headConsumed).toBe(true);
        const forgedWire = JSON.stringify({
            ...promotion,
            clips: promotion.clips.map((source) => ({
                ...source,
                after: { ...source.after, audioOffsetSeconds: 19, audioUnwrappedOffsetSeconds: 19 },
            })),
        });
        expect(forgedWire).toContain('"audioOffsetSeconds":19');
        expect(forgedWire).toContain('"audioUnwrappedOffsetSeconds":19');
        const forged = JSON.parse(forgedWire);
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240, audioSourcePromotion: forged } });
        expect(sourceEntries()).toEqual([4]);
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(4);
        authority();
    });

    it.each(['clip', 'comp', 'placed', 'inactive'] as const)(
        'restores exact %s source facets and legacy absence through production session admission after a binary reload',
        async (programme) => {
            if (programme === 'comp') {
                installClip(clip({ loopEnabled: true, loopLength: 4, stretchMode: 'timestretch', stretchRatio: 2 }));
                takeLaneStore.set({
                    lanes: [
                        {
                            id: 'lane',
                            trackId: 'audio',
                            takes: [
                                {
                                    id: 'selected',
                                    clipId: 'source',
                                    name: 'Selected',
                                    startBeat: 0,
                                    endBeat: 12,
                                    selected: true,
                                    sourceOffsetBeats: 4,
                                },
                                {
                                    id: 'future',
                                    clipId: 'source',
                                    name: 'Future',
                                    startBeat: 0,
                                    endBeat: 12,
                                    selected: false,
                                    sourceOffsetBeats: 6,
                                },
                            ],
                            activeCompRegions: [{ startBeat: 1, endBeat: 11, takeId: 'selected' }],
                        },
                    ],
                });
            }
            if (programme === 'placed') {
                installClip(
                    clip({
                        startBeat: 17,
                        endBeat: 40,
                        audioOffsetBeats: 17,
                        stretchMode: 'timestretch',
                        stretchRatio: 2,
                    })
                );
                takeLaneStore.set({
                    lanes: [
                        {
                            id: 'lane',
                            trackId: 'audio',
                            takes: [
                                {
                                    id: 'placed',
                                    clipId: 'source',
                                    name: 'Placed',
                                    startBeat: 17,
                                    endBeat: 40,
                                    selected: true,
                                    sourceOffsetBeats: 4,
                                    passAnchorSeconds: 10.5,
                                    passDepthSeconds: 2,
                                    passSourceEndSeconds: 6,
                                },
                            ],
                            activeCompRegions: [{ startBeat: 17, endBeat: 40, takeId: 'placed' }],
                        },
                    ],
                });
            }
            if (programme === 'inactive') {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        activeAlternativeId: 'main',
                        alternatives: [
                            { id: 'main', name: 'Main', clips: [] },
                            { id: 'other', name: 'Other', clips: [clip({ id: 'alternate' })] },
                        ],
                    })),
                });
            }
            authority();
            sessionStorage.removeItem('sourdaw-undo-session');
            registerProductionTempoHandlers();
            const before = structuredClone(trackStore.value!.tracks);
            const beforeLanes = structuredClone(takeLaneStore.value);
            const beforeEntries = sourceEntries();
            await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });
            authority();
            const after = structuredClone(trackStore.value!.tracks);
            const afterLanes = structuredClone(takeLaneStore.value);
            expect(sourceEntries()).toEqual(beforeEntries);
            await vi.waitFor(() => {
                const mirror = sessionStorage.getItem('sourdaw-undo-session');
                expect(mirror).not.toBeNull();
                expect(JSON.parse(mirror!).past).toHaveLength(1);
            });
            const doc = getCrdtDoc('root');
            if (!doc) {
                throw new Error('Expected a committed project');
            }
            replaceCrdtDocInLineage({ id: 'root', doc: Automerge.load(Automerge.save(doc)) });
            projectCrdtToStores({ resetProjections: true });
            registerProductionTempoHandlers();
            expect(undoStore.value?.past).toHaveLength(1);
            expect(trackStore.value!.tracks).toEqual(after);
            expect(takeLaneStore.value).toEqual(afterLanes);
            expect((await undo()).headConsumed).toBe(true);
            expect(trackStore.value!.tracks).toEqual(before);
            expect(takeLaneStore.value).toEqual(beforeLanes);
            expect(trackStore.value!.tracks[0]!.clips[0]).not.toHaveProperty('audioOffsetSeconds');
            expect(sourceEntries()).toEqual(beforeEntries);
            authority();
            await redo();
            expect(trackStore.value!.tracks).toEqual(after);
            expect(takeLaneStore.value).toEqual(afterLanes);
            expect(sourceEntries()).toEqual(beforeEntries);
            authority();
        }
    );

    it.each(['clip', 'take'] as const)(
        'refuses the registered inverse when raw %s inputs change after its private capture',
        async (changed) => {
            takeLaneStore.set({
                lanes: [
                    {
                        id: 'lane',
                        trackId: 'audio',
                        takes: [
                            {
                                id: 'future',
                                clipId: 'source',
                                name: 'Future',
                                startBeat: 0,
                                endBeat: 12,
                                selected: false,
                                sourceOffsetBeats: 4,
                            },
                        ],
                        activeCompRegions: [],
                    },
                ],
            });
            authority();
            await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });
            const entry = undoHistoryStore.value?.past.at(-1);
            if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'restoreTempoEdit') {
                throw new Error('Expected the real registered tempo inverse');
            }
            const inverse = entry.inverseAction;
            const handler = getTransportHandlers().restoreTempoEdit;
            if (handler.previewExecution !== 'isolated-project') {
                throw new Error('Expected synchronous project tempo replay');
            }
            const transaction = runWithAutomergeStorageTransaction(undefined, () => handler.execute(inverse));
            if (transaction.status === 'threw') {
                transaction.abort();
                throw transaction.error;
            }
            const result = transaction.value;
            if (!result || result.status !== 'written' || !result.commitValidation) {
                transaction.abort();
                throw new Error('Expected the actual source-owner commit guard');
            }
            const guard = result.commitValidation;
            bindCommitGuard(transaction, guard);
            mutateCrdtDoc<{
                tracks: { tracks: { clips: Clip[] }[] };
                takeLanes: NonNullable<typeof takeLaneStore.value>;
            }>({
                id: 'root',
                changeFn: (doc) => {
                    if (changed === 'clip') {
                        doc.tracks.tracks[0]!.clips[0]!.audioOffsetBeats = 10;
                    } else {
                        doc.takeLanes.lanes[0]!.takes[0]!.sourceOffsetBeats = 5;
                    }
                },
            });
            const before = getCrdtDoc('root');
            const history = structuredClone(undoHistoryStore.value);
            try {
                expect(() => transaction.commit()).toThrow(AutomergeStorageWriteConflictError);
            } finally {
                transaction.abort();
                guard.release();
            }
            expect(getCrdtDoc('root')).toBe(before);
            expect(undoHistoryStore.value).toEqual(history);
            expect(transportStore.value?.tempo).toBe(240);
            projectCrdtToStores({ resetProjections: true });
            expect(getCrdtDoc('root')).toBe(before);
            authority();
        }
    );

    it.each(['clip', 'take'] as const)(
        'refuses peer removal of owned raw %s source fields after private capture',
        async (changed) => {
            takeLaneStore.set({
                lanes: [
                    {
                        id: 'lane',
                        trackId: 'audio',
                        takes: [
                            {
                                id: 'future',
                                clipId: 'source',
                                name: 'Future',
                                startBeat: 0,
                                endBeat: 12,
                                selected: false,
                                sourceOffsetBeats: 4,
                            },
                        ],
                        activeCompRegions: [],
                    },
                ],
            });
            authority();
            await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });
            const entry = undoHistoryStore.value?.past.at(-1);
            if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'restoreTempoEdit') {
                throw new Error('Expected the real registered tempo inverse');
            }
            const inverse = entry.inverseAction;
            const handler = getTransportHandlers().restoreTempoEdit;
            if (handler.previewExecution !== 'isolated-project') {
                throw new Error('Expected synchronous project tempo replay');
            }
            const transaction = runWithAutomergeStorageTransaction(undefined, () => handler.execute(inverse));
            if (transaction.status === 'threw') {
                transaction.abort();
                throw transaction.error;
            }
            const result = transaction.value;
            if (!result || result.status !== 'written' || !result.commitValidation) {
                transaction.abort();
                throw new Error('Expected the actual source-owner commit guard');
            }
            const guard = result.commitValidation;
            bindCommitGuard(transaction, guard);
            mutateCrdtDoc<{
                tracks: { tracks: { clips: Clip[] }[] };
                takeLanes: NonNullable<typeof takeLaneStore.value>;
            }>({
                id: 'root',
                changeFn: (doc) => {
                    if (changed === 'clip') {
                        delete doc.tracks.tracks[0]!.clips[0]!.audioOffsetSeconds;
                        delete doc.tracks.tracks[0]!.clips[0]!.audioUnwrappedOffsetSeconds;
                    } else {
                        delete doc.takeLanes.lanes[0]!.takes[0]!.sourceOffsetSeconds;
                    }
                },
            });
            const before = getCrdtDoc('root');
            const history = structuredClone(undoHistoryStore.value);
            try {
                expect(() => transaction.commit()).toThrow(AutomergeStorageWriteConflictError);
            } finally {
                transaction.abort();
                guard.release();
            }
            expect(getCrdtDoc('root')).toBe(before);
            expect(undoHistoryStore.value).toEqual(history);
            expect(transportStore.value?.tempo).toBe(240);
            projectCrdtToStores({ resetProjections: true });
            expect(getCrdtDoc('root')).toBe(before);
            authority();
        }
    );

    it('preserves a valid empty clip source entry without refusing the tempo gesture', async () => {
        installClip(clip({ endBeat: 0 }));
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });
        expect(transportStore.value?.tempo).toBe(240);
        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({ endBeat: 0, audioOffsetSeconds: 4 });
        expect((await undo()).headConsumed).toBe(true);
        expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
        authority();
    });

    it('keeps source replay out of provider discovery and keeps the public tempo arguments unchanged', () => {
        expect(
            getExecutableAppActionToolSchemas().some((schema) => String(schema.function.name) === 'restoreTempoMapEdit')
        ).toBe(false);
        const registrations = getExecutableCommandRegistrations();
        expect(registrations.some((registration) => String(registration.actionType) === 'restoreTempoMapEdit')).toBe(
            false
        );
        expect(registrations.find((registration) => registration.actionType === 'setTempo')?.providerSchema).toEqual({
            properties: { bpm: { type: 'number' } },
            required: ['bpm'],
        });
    });

    it.each(['base', 'map'] as const)(
        'refuses a raw %s tempo replacement after actual forward source capture',
        (target) => {
            if (target === 'map') {
                tempoMapStore.set({ changes: [{ id: 'first', beat: 0, tempo: 120, curve: 'instant' }] });
                authority();
            }
            const action: Extract<AppAction, { type: 'setTempo' }> = { type: 'setTempo', payload: { bpm: 240 } };
            const handler = getTransportHandlers().setTempo;
            if (handler.previewExecution !== 'isolated-project') {
                throw new Error('Expected synchronous project tempo execution');
            }
            if (!handler.materializeCommandArguments) {
                throw new Error('Expected real tempo admission');
            }
            handler.materializeCommandArguments(action);
            const transaction = runWithAutomergeStorageTransaction(undefined, () => handler.execute(action));
            mutateCrdtDoc<{ transport: { tempo: number }; tempoMap: NonNullable<typeof tempoMapStore.value> }>({
                id: 'root',
                changeFn: (doc) => {
                    if (target === 'base') {
                        doc.transport.tempo = 240;
                    } else {
                        doc.tempoMap.changes[0]!.tempo = 240;
                    }
                },
            });
            const before = getCrdtDoc('root');
            try {
                expect(() => transaction.commit()).toThrow(AutomergeStorageWriteConflictError);
            } finally {
                transaction.abort();
            }
            expect(getCrdtDoc('root')).toBe(before);
            expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
            expect(sourceEntries()).toEqual([2]);
            expect(undoStore.value?.past).toHaveLength(0);
            authority();
        }
    );

    it('preserves source admission when an unrelated transport write shares the same transaction first', () => {
        const action: Extract<AppAction, { type: 'setTempo' }> = { type: 'setTempo', payload: { bpm: 240 } };
        const handlers = getTransportHandlers();
        if (!handlers.setTempo.materializeCommandArguments) {
            throw new Error('Expected real tempo admission');
        }
        handlers.setTempo.materializeCommandArguments(action);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            handlers.setCountInBars.execute({ type: 'setCountInBars', payload: { bars: 2 } });
            handlers.setTempo.execute(action);
        });
        transaction.commit();
        expect(transportStore.value).toMatchObject({ tempo: 240, countInBars: 2 });
        expect(sourceEntries()).toEqual([4]);
        authority();
    });

    it('previews a legacy source promotion without treating persisted media guards as a new asset import', async () => {
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        commandBatchPreviewPort.setProvider(createCommandPreviewWorkspace);
        commandBatchPreflightPort.setProvider((input) => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'tempo-source-preview',
            projectInvariantsValid: true,
            targetFingerprints: captureCommandTargetFingerprints({
                document: input.projectDocument ?? getCrdtDoc('root'),
                targetIds: input.targetIds,
            }),
        }));
        const revision = captureProjectRevision();
        const command = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: { type: 'setTempo', payload: { bpm: 240 } },
            normalizedProjectRevision: revision,
        });
        expect(command.arguments).toMatchObject({
            audioSourcePromotion: {
                clips: [
                    {
                        trackId: 'audio',
                        clipId: 'source',
                        inputs: { audioBufferId: 'bursts' },
                        after: { audioOffsetSeconds: 4 },
                    },
                ],
            },
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: revision,
            batchId: 'tempo-source-preview-batch',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview a tempo edit with preserved audio',
            mode: 'preview',
            projectId: 'tempo-source-preview',
            runId: 'tempo-source-preview-run',
        });
        const preview = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });
        let detail = 'Previewed source programme';
        if (preview.status !== 'previewed') {
            detail = JSON.stringify(preview);
        }
        expect(preview, detail).toMatchObject({
            status: 'previewed',
            projectDocument: {
                transport: { tempo: 240 },
                tracks: { tracks: [{ id: 'audio', clips: [{ id: 'source', audioOffsetSeconds: 4 }] }] },
            },
        });
        if (preview.status !== 'previewed') {
            throw new Error('Expected an isolated tempo/source preview');
        }
        try {
            expect(transportStore.value?.tempo).toBe(120);
            expect(trackStore.value?.tracks[0]?.clips[0]).not.toHaveProperty('audioOffsetSeconds');
            expect(sourceEntries()).toEqual([4]);
            expect(undoStore.value?.past).toHaveLength(0);
        } finally {
            preview.resource.release();
        }
        authority();
    });

    it.each(['legacy', 'canonical'] as const)(
        'binds newly live %s source owners at the registered forward write',
        (kind) => {
            const action: Extract<AppAction, { type: 'setTempo' }> = { type: 'setTempo', payload: { bpm: 240 } };
            const handler = getTransportHandlers().setTempo;
            if (handler.previewExecution !== 'isolated-project') {
                throw new Error('Expected synchronous project tempo execution');
            }
            if (!handler.materializeCommandArguments) {
                throw new Error('Expected real tempo admission');
            }
            handler.materializeCommandArguments(action);
            let peer = clip({ id: 'peer', startBeat: 16, endBeat: 28 });
            if (kind === 'canonical') {
                peer = { ...peer, audioOffsetSeconds: 0, audioUnwrappedOffsetSeconds: 0 };
            }
            const state = trackStore.value!;
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => ({ ...track, clips: [...track.clips, peer] })),
            });
            authority();
            const before = getCrdtDoc('root');
            const transaction = runWithAutomergeStorageTransaction(undefined, () => handler.execute(action));
            if (transaction.status === 'threw') {
                transaction.abort();
                throw transaction.error;
            }
            if (transaction.value && transaction.value.status === 'written') {
                transaction.commit();
            } else {
                transaction.abort();
            }
            if (kind === 'legacy') {
                expect(sourceEntries()).toEqual([4, 4]);
                expect(transaction.value).toMatchObject({ status: 'conflict' });
                expect(getCrdtDoc('root')).toBe(before);
                expect(transportStore.value?.tempo).toBe(120);
            } else {
                expect(transaction.value).toMatchObject({ status: 'written' });
                expect(sourceEntries()).toEqual([4, 0]);
                expect(trackStore.value?.tracks[0]?.clips.find((source) => source.id === 'peer')).toEqual(peer);
            }
            expect(undoStore.value?.past).toHaveLength(0);
            authority();
        }
    );

    it.each(['owner', 'media'] as const)(
        'refuses a forged saved source capture %s without writes or history changes',
        async (field) => {
            await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });
            const entry = undoHistoryStore.value?.past.at(-1);
            if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'restoreTempoEdit') {
                throw new Error('Expected the actual saved tempo inverse');
            }
            const action = structuredClone(entry.inverseAction);
            const source = action.payload.audioSourcePromotion.clips[0];
            if (!source) {
                throw new Error('Expected a real source owner capture');
            }
            if (field === 'owner') {
                action.payload.audioSourcePromotion = {
                    ...action.payload.audioSourcePromotion,
                    clips: [{ ...source, clipId: 'missing-owner' }],
                };
            } else {
                action.payload.audioSourcePromotion = {
                    ...action.payload.audioSourcePromotion,
                    clips: [{ ...source, inputs: { ...source.inputs, audioBufferId: 'different-media' } }],
                };
            }
            const before = getCrdtDoc('root');
            const history = structuredClone(undoHistoryStore.value);
            let refused = false;
            try {
                const actionWire = JSON.stringify(action);
                if (field === 'owner') {
                    expect(actionWire).toContain('"clipId":"missing-owner"');
                } else {
                    expect(actionWire).toContain('"audioBufferId":"different-media"');
                }
                await executeAppAction(JSON.parse(actionWire));
            } catch (error) {
                if (!isAppActionConflictError(error)) {
                    throw error;
                }
                refused = true;
            }
            expect(refused).toBe(true);
            expect(getCrdtDoc('root')).toBe(before);
            expect(undoHistoryStore.value).toEqual(history);
            expect(sourceEntries()).toEqual([4]);
            authority();
        }
    );

    it.each([
        'legacy-clip',
        'empty-canonical',
        'empty-no-audio',
        'legacy-take',
        'new-region',
        'canonical-peer',
        'inactive-legacy',
        'ambiguous-peer',
        'malformed-peer',
        'uncovered-gap',
    ] as const)('authenticates raw late source coverage after synchronous capture: %s', (kind) => {
        if (
            kind === 'empty-canonical' ||
            kind === 'legacy-take' ||
            kind === 'new-region' ||
            kind === 'inactive-legacy' ||
            kind === 'malformed-peer'
        ) {
            installClip(clip({ audioOffsetSeconds: 4, audioUnwrappedOffsetSeconds: 4 }));
        }
        if (kind === 'empty-no-audio') {
            const state = trackStore.value!;
            trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, clips: [] })) });
        }
        if (kind === 'new-region' || kind === 'ambiguous-peer' || kind === 'uncovered-gap') {
            takeLaneStore.set({
                lanes: [
                    {
                        id: 'lane',
                        trackId: 'audio',
                        takes: [
                            {
                                id: 'future',
                                clipId: 'source',
                                name: 'Future',
                                startBeat: 0,
                                endBeat: 12,
                                selected: false,
                                sourceOffsetBeats: 4,
                                sourceOffsetSeconds: 2,
                            },
                        ],
                        activeCompRegions: [],
                    },
                ],
            });
        }
        authority();
        const action: Extract<AppAction, { type: 'setTempo' }> = { type: 'setTempo', payload: { bpm: 240 } };
        const handler = getTransportHandlers().setTempo;
        if (handler.previewExecution !== 'isolated-project') {
            throw new Error('Expected synchronous project tempo execution');
        }
        if (!handler.materializeCommandArguments) {
            throw new Error('Expected real tempo admission');
        }
        handler.materializeCommandArguments(action);
        if (
            kind !== 'legacy-clip' &&
            kind !== 'canonical-peer' &&
            kind !== 'ambiguous-peer' &&
            kind !== 'uncovered-gap'
        ) {
            expect(action.payload.audioSourcePromotion).toMatchObject({ clips: [], takes: [], regions: [], gaps: [] });
        }
        const transaction = runWithAutomergeStorageTransaction(undefined, () => handler.execute(action));
        if (transaction.status === 'threw') {
            transaction.abort();
            throw transaction.error;
        }
        expect(transaction.value).toMatchObject({ status: 'written' });
        let peer = clip({ id: 'peer', startBeat: 16, endBeat: 28 });
        if (kind === 'canonical-peer') {
            peer = { ...peer, audioOffsetSeconds: 0, audioUnwrappedOffsetSeconds: 0 };
        }
        if (kind === 'ambiguous-peer') {
            peer = { ...peer, id: 'source', audioOffsetSeconds: 0, audioUnwrappedOffsetSeconds: 0 };
        }
        if (kind === 'malformed-peer') {
            peer = { ...peer, audioLoopStartSeconds: 0 };
        }
        mutateCrdtDoc<{
            tracks: { tracks: { clips: Clip[]; alternatives: { id: string; name: string; clips: Clip[] }[] }[] };
            takeLanes: NonNullable<typeof takeLaneStore.value>;
        }>({
            id: 'root',
            changeFn: (doc) => {
                if (kind === 'legacy-take') {
                    doc.takeLanes.lanes = [
                        {
                            id: 'lane',
                            trackId: 'audio',
                            takes: [
                                {
                                    id: 'future',
                                    clipId: 'source',
                                    name: 'Future',
                                    startBeat: 0,
                                    endBeat: 12,
                                    selected: true,
                                    sourceOffsetBeats: 4,
                                },
                            ],
                            activeCompRegions: [{ startBeat: 0, endBeat: 12, takeId: 'future' }],
                        },
                    ];
                } else if (kind === 'new-region') {
                    doc.takeLanes.lanes[0]!.activeCompRegions = [{ startBeat: 1, endBeat: 11, takeId: 'future' }];
                } else if (kind === 'uncovered-gap') {
                    // The selected source is already physical. Only its newly
                    // exposed base gaps still require the old-map capture.
                    doc.takeLanes.lanes[0]!.activeCompRegions = [
                        {
                            startBeat: 1,
                            endBeat: 11,
                            takeId: 'future',
                            audioSource: {
                                startBeat: 1,
                                audioOffsetSeconds: 6.5,
                                audioLoopStartSeconds: 6.5,
                                audioLoopPassEntrySeconds: 6.5,
                                audioLoopPassOriginBeat: 1,
                                loopOriginBeat: 1,
                                loopLength: 10,
                            },
                        },
                    ];
                } else if (kind === 'inactive-legacy' || kind === 'ambiguous-peer') {
                    doc.tracks.tracks[0]!.alternatives.push({
                        id: 'peer-alternative',
                        name: 'Peer alternative',
                        clips: [peer],
                    });
                } else {
                    doc.tracks.tracks[0]!.clips.push(peer);
                }
            },
        });
        const before = getCrdtDoc('root');
        if (!before) {
            throw new Error('Expected the raw peer document');
        }
        const beforeHeads = Automerge.getHeads(before);
        const history = structuredClone(undoHistoryStore.value);
        let refused = false;
        try {
            transaction.commit();
        } catch (error) {
            if (!(error instanceof AutomergeStorageWriteConflictError)) {
                throw error;
            }
            refused = true;
        } finally {
            transaction.abort();
        }
        // Slots with no local source write have no commit terminal to
        // project the peer's raw publication. Read fresh owning projections.
        trackStore.hydrate();
        takeLaneStore.hydrate();
        transportStore.hydrate();
        tempoMapStore.hydrate();
        if (kind === 'canonical-peer') {
            expect(refused).toBe(false);
            expect(sourceEntries()).toEqual([4, 0]);
            expect(trackStore.value?.tracks[0]?.clips.find((source) => source.id === 'peer')).toEqual(peer);
        } else {
            // Eight legacy source beats and four legacy take beats read
            // at the actual old 120 BPM, before any clock write.
            let entries = [4, 4];
            if (kind === 'empty-no-audio') {
                entries = [4];
            }
            if (kind === 'legacy-take') {
                entries = [6];
            }
            if (kind === 'new-region' || kind === 'uncovered-gap') {
                entries = [4, 6.5, 9.5];
            }
            if (kind === 'inactive-legacy' || kind === 'ambiguous-peer') {
                entries = [4];
            }
            expect(sourceEntries()).toEqual(entries);
            if (kind === 'inactive-legacy') {
                const inactive = trackStore.value?.tracks[0]?.alternatives.find(
                    (alternative) => alternative.id === 'peer-alternative'
                )?.clips;
                if (!inactive) {
                    throw new Error('Expected the raw peer inactive alternative');
                }
                expect(sourceEntries(inactive)).toEqual([4]);
            }
            expect(refused).toBe(true);
            expect(getCrdtDoc('root')).toBe(before);
            expect(Automerge.getHeads(getCrdtDoc('root')!)).toEqual(beforeHeads);
            expect(transportStore.value?.tempo).toBe(120);
        }
        expect(undoHistoryStore.value).toEqual(history);
        if (kind === 'malformed-peer') {
            // The raw orphan loop anchor is intentionally invalid; the owning
            // Track projection drops it, so these two views cannot be identical.
            flushAutomergeStorageWrites();
            const rawTracks = getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root')?.tracks;
            if (!rawTracks) {
                throw new Error('Expected raw peer tracks');
            }
            const rawPeer = rawTracks.tracks[0]?.clips.find((candidate) => candidate.id === 'peer');
            expect(rawPeer?.audioLoopStartSeconds).toBe(0);
            expect(Object.hasOwn(rawPeer ?? {}, 'audioOffsetSeconds')).toBe(false);
            expect(hasValidAudioSourceState(rawPeer)).toBe(false);
            const projected = sanitizeTrackSnapshot(rawTracks).tracks;
            expect(trackStore.value?.tracks).toEqual(projected);
            const projectedPeer = projected[0]?.clips.find((candidate) => candidate.id === 'peer');
            expect(projectedPeer?.audioOffsetBeats).toBe(8);
            expect(projectedPeer).not.toHaveProperty('audioLoopStartSeconds');
            expect(Automerge.toJS(before)).toMatchObject({
                takeLanes: takeLaneStore.value,
                transport: { tempo: transportStore.value!.tempo },
                tempoMap: tempoMapStore.value,
            });
        } else {
            authority();
        }
    });

    it('rejects individually valid saved replay legs that disagree with the forward source capture', async () => {
        sessionStorage.removeItem('sourdaw-undo-session');
        registerProductionTempoHandlers();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });
        await vi.waitFor(() =>
            expect(JSON.parse(sessionStorage.getItem('sourdaw-undo-session')!).past).toHaveLength(1)
        );
        const mirror = JSON.parse(sessionStorage.getItem('sourdaw-undo-session')!);
        mirror.past[0].inverseAction.payload.sourceDirection = 'promote';
        sessionStorage.setItem('sourdaw-undo-session', JSON.stringify(mirror));
        const before = getCrdtDoc('root');
        registerProductionTempoHandlers();
        expect(undoStore.value?.past).toHaveLength(0);
        expect(getCrdtDoc('root')).toBe(before);
        expect(transportStore.value?.tempo).toBe(240);
        expect(sourceEntries()).toEqual([4]);
        authority();
    });

    it('keeps canonical zero and its independent loop anchors authoritative over stale beat offsets', async () => {
        installClip(
            clip({
                audioOffsetSeconds: 0,
                audioUnwrappedOffsetSeconds: 4,
                audioLoopStartSeconds: -0.5,
                audioLoopPassEntrySeconds: 1,
                audioLoopPassOriginBeat: 0,
                loopEnabled: true,
                loopLength: 4,
            })
        );
        const before = structuredClone(trackStore.value);
        expect(sourceEntries()).toEqual([0]);
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });

        expect(trackStore.value).toEqual(before);
        expect(sourceEntries()).toEqual([0]);
        authority();
    });

    it('preserves a previously unselected take depth before its first real comp selection', async () => {
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane',
                    trackId: 'audio',
                    takes: [
                        {
                            id: 'future',
                            clipId: 'source',
                            name: 'Future phrase',
                            startBeat: 0,
                            endBeat: 12,
                            selected: false,
                            sourceOffsetBeats: 4,
                        },
                    ],
                    activeCompRegions: [],
                },
            ],
        });
        authority();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });
        await executeAppAction({
            type: 'setCompRegion',
            payload: { trackId: 'audio', startBeat: 0, endBeat: 12, takeId: 'future' },
        });

        expect(sourceEntries()).toEqual([6]);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.sourceOffsetSeconds).toBe(2);
        authority();
    });

    it('captures the placed pass original media basis while retaining physical depth and exclusive end', async () => {
        installClip(
            clip({
                startBeat: 17,
                endBeat: 40,
                audioOffsetBeats: 17,
                stretchMode: 'timestretch',
                stretchRatio: 2,
            })
        );
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane',
                    trackId: 'audio',
                    takes: [
                        {
                            id: 'placed',
                            clipId: 'source',
                            name: 'Placed phrase',
                            startBeat: 17,
                            endBeat: 40,
                            selected: true,
                            sourceOffsetBeats: 4,
                            passAnchorSeconds: 10.5,
                            passDepthSeconds: 2,
                            passSourceEndSeconds: 6,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 17, endBeat: 40, takeId: 'placed' }],
                },
            ],
        });
        authority();
        const legacyPass = resolveClipsWithComping('audio', trackStore.value!.tracks[0]!.clips)[0];
        expect(legacyPass).toMatchObject({ startBeat: 19 });
        expect(legacyPass).not.toHaveProperty('audioOffsetSeconds');
        expect(sourceEntries()).toEqual([2]);
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });

        expect(takeLaneStore.value?.lanes[0]?.takes[0]).toMatchObject({
            passOriginBeat: 17,
            passOriginSourceSeconds: 8.5,
            passAnchorSeconds: 10.5,
            passDepthSeconds: 2,
            passSourceEndSeconds: 6,
        });
        expect(resolveClipsWithComping('audio', trackStore.value!.tracks[0]!.clips)).toMatchObject([
            { startBeat: 21, endBeat: 29, audioOffsetSeconds: 2 },
        ]);
        authority();
    });

    it('preserves a previously inactive alternative through registered switch, tempo edit and reactivation', async () => {
        const current = trackStore.value!;
        const track = current.tracks[0]!;
        trackStore.set({
            ...current,
            tracks: [
                {
                    ...track,
                    activeAlternativeId: 'main',
                    alternatives: [
                        { id: 'main', name: 'Main phrase', clips: [] },
                        { id: 'other', name: 'Other phrase', clips: [clip({ id: 'alternate' })] },
                    ],
                },
            ],
        });
        authority();
        await executeAppAction({
            type: 'switchTrackAlternative',
            payload: { trackId: 'audio', alternativeId: 'other' },
        });
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('alternate');
        expect(sourceEntries()).toEqual([4]);
        await executeAppAction({
            type: 'switchTrackAlternative',
            payload: { trackId: 'audio', alternativeId: 'main' },
        });
        await executeAppAction({ type: 'setTempo', payload: { bpm: 240 } });
        await executeAppAction({
            type: 'switchTrackAlternative',
            payload: { trackId: 'audio', alternativeId: 'other' },
        });

        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('alternate');
        expect(sourceEntries()).toEqual([4]);
        authority();
    });
});
