import { clone } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type ModulationStoreState, modulationRuntimeStore, modulationStore } from '#/modules/Automation/stores';
import { addMapping, addModulator, setModulationDependencies } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    hasCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    replaceCrdtDoc,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore, type TrackStoreState } from '../../../stores/trackStore';
import { setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

// The real removeTrack emits `track.removed` on the Arrangement bus; the bulk
// handler runs it unsuppressed, so the harness must wire one.
type ArrangementTrackEvents = {
    'track.added': { trackId: string; name: string; kind: string };
    'track.removed': { trackId: string };
    'track.selectionChanged': { trackId: string | null; previousTrackId: string | null };
};

const writeModulationParam = vi.fn();

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

type StorageRuntimeDoc = {
    [key: string]: unknown;
};

/**
 * The storage runtime with one production hazard injected: every document
 * mutation publishes, then the port dies before the commit reports. That is
 * exactly the partial-commit shape executeAppActionBatch reconciles as an
 * ambiguous commit, which is the only route that runs a handler's
 * afterAmbiguousCommit finalizers.
 */
function registerVolatileStorageRuntime(afterPublication?: () => void, ambiguous = true): void {
    configureAutomergeStoragePort({
        getDoc: (docId) => getCrdtDoc<StorageRuntimeDoc>(docId),
        hasDoc: (docId) => hasCrdtDoc(docId),
        getSemanticMessage: () => undefined,
        mutateDoc: ({ docId, changedKeys, changeFn, message, snapshotTransaction }) => {
            mutateCrdtDoc<StorageRuntimeDoc>({
                id: docId,
                changeFn,
                message,
                snapshotTransaction,
                localSlots: changedKeys,
            });
            afterPublication?.();
            if (ambiguous) {
                throw new Error('Simulated storage loss after the change published');
            }
        },
    });
}

type Project = {
    tracks: TrackStoreState;
    modulation: { modulators: Modulator[] };
};

/** Structural view of the Automation module's modulator rows (index-only boundary). */
type Modulator = ModulationStoreState['modulators'][number];

function track(id: string, kind: 'audio' | 'midi' = 'audio') {
    return TrackDummy.create({ id, kind });
}

function liveModulators(): Modulator[] {
    const modulators = modulationStore.value?.modulators;
    if (!modulators) {
        throw new Error('Expected the modulation store');
    }
    return modulators;
}

function modulatorById(id: string): Modulator | null {
    return liveModulators().find((modulator) => modulator.id === id) ?? null;
}

function documentModulators(document: { modulation: { modulators: Modulator[] } } | null | undefined): Modulator[] {
    if (!document) {
        throw new Error('Expected the project document');
    }
    return document.modulation.modulators;
}

function seedArrangement(): { tracks: TrackStoreState; modulators: Modulator[] } {
    const tracks: TrackStoreState = {
        tracks: [track('t1', 'midi'), track('t2'), track('t3')],
        selectedTrackId: 't2',
        ghostClips: [],
    };
    trackStore.set(tracks);
    modulationStore.set({ modulators: [] });
    flushAutomergeStorageWrites();
    addModulator(
        {
            name: 'Filter LFO',
            trackId: 't1',
            kind: 'lfo',
            config: { kind: 'lfo', waveform: 'sine', rate: 1, sync: false, phase: 0, depth: 0.5 },
            mappings: [],
            enabled: true,
        },
        'mod-t1'
    );
    addModulator(
        {
            name: 'Sidechain Env',
            trackId: 't2',
            kind: 'envelope',
            config: { kind: 'envelope', attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3, triggerMode: 'midi' },
            mappings: [],
            enabled: true,
        },
        'mod-t2'
    );
    addMapping('mod-t2', { targetTrackId: 't1', targetDeviceId: 'device-a', targetParamId: 'cutoff', amount: 0.4 });
    addMapping('mod-t2', { targetTrackId: 't3', targetDeviceId: 'device-b', targetParamId: 'gain', amount: -0.2 });
    flushAutomergeStorageWrites();
    return { tracks, modulators: structuredClone(liveModulators()) };
}

function expectPriorModulationTruth(): void {
    expect(modulatorById('mod-t1')).toMatchObject({ trackId: 't1' });
    const modT2 = modulatorById('mod-t2');
    expect(modT2?.trackId).toBe('t2');
    expect(modT2?.mappings).toEqual([
        { targetTrackId: 't1', targetDeviceId: 'device-a', targetParamId: 'cutoff', amount: 0.4 },
        { targetTrackId: 't3', targetDeviceId: 'device-b', targetParamId: 'gain', amount: -0.2 },
    ]);
}

function expectNoDeletedTrackReferences(deletedTrackIds: readonly string[]): void {
    for (const modulator of liveModulators()) {
        expect(deletedTrackIds).not.toContain(modulator.trackId);
        for (const mapping of modulator.mappings) {
            expect(deletedTrackIds).not.toContain(mapping.targetTrackId);
        }
    }
}

describe('removeAllTracks modulation lifecycle (#5090)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('remove all tracks modulation integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        sessionStorage.removeItem('sourdaw-undo-session');
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        modulationRuntimeStore.set({ runtimeValues: {} });
        writeModulationParam.mockClear();
        setModulationDependencies({
            updateDeviceParam: writeModulationParam,
            getPluginParamRange: () => ({ min: 0, max: 1, defaultValue: 0.5, automatable: true }),
            quantiseValue: ({ value }) => value,
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        modulationStore.set({ modulators: [] });
        modulationRuntimeStore.set({ runtimeValues: {} });
        sessionStorage.removeItem('sourdaw-undo-session');
    });

    it('bulk deletion removes owned modulators and mappings naming the deleted tracks', async () => {
        seedArrangement();

        const result = await executeAppActionBatch([{ type: 'removeAllTracks', payload: undefined }]);

        expect(result.status).toBe('committed');
        expect(trackStore.value?.tracks).toEqual([]);
        expectNoDeletedTrackReferences(['t1', 't2', 't3']);
        expect(undoHistoryStore.value?.past).toHaveLength(1);

        flushAutomergeStorageWrites();
        const document = getCrdtDoc<Project>('root');
        if (!document) {
            throw new Error('Expected the project document');
        }
        expect(document.tracks.tracks).toEqual([]);
        expect(documentModulators(document)).toEqual([]);
    });

    it('a committed bulk removal finalizes the deferred modulation runtime', async () => {
        seedArrangement();
        modulationRuntimeStore.set({ runtimeValues: { 'mod-t1': 0.42, 'mod-t2': -0.2 } });

        const result = await executeAppActionBatch([{ type: 'removeAllTracks', payload: undefined }]);

        expect(result.status).toBe('committed');
        // The commit ran the handler's afterCommit: the deferred finalizers
        // reverted the removed modulators' runtime so no engine override
        // outlives its owner. Dropping the finalizer registration strands both
        // runtime values here.
        expect(modulationRuntimeStore.value).toEqual({ runtimeValues: {} });
        expect(liveModulators()).toEqual([]);
    });

    it('an ambiguous bulk commit reconciles the deferred runtime against durable truth', async () => {
        seedArrangement();
        modulationRuntimeStore.set({ runtimeValues: { 'mod-t1': 0.42, 'mod-t2': -0.2 } });
        registerVolatileStorageRuntime();

        const result = await executeAppActionBatch([{ type: 'removeAllTracks', payload: undefined }]);

        // The change published before the port died, so the durable document
        // carries the removal even though the batch reports the commit as
        // ambiguous. The handler's afterAmbiguousCommit reconciled the runtime
        // for the modulators durable truth still shows removed — the commit
        // route's afterCommit never runs on this path.
        expect(result.status).toBe('ambiguous');
        const document = getCrdtDoc<Project>('root');
        if (!document) {
            throw new Error('Expected the project document');
        }
        expect(document.tracks.tracks).toEqual([]);
        expect(documentModulators(document)).toEqual([]);
        expect(modulationRuntimeStore.value).toEqual({ runtimeValues: {} });
    });

    it.each([
        ['removeAllTracks', false],
        ['removeAllTracks', true],
        ['removeTrack', false],
        ['removeTrack', true],
    ] as const)(
        'releases a deleted modulator when only its track returns after %s, ambiguous=%s',
        async (type, ambiguous) => {
            const seeded = seedArrangement();
            const restoredTrack = seeded.tracks.tracks.find((candidate) => candidate.id === 't1');
            if (!restoredTrack) {
                throw new Error('Expected the original track');
            }
            modulationRuntimeStore.set({ runtimeValues: { 'mod-t1': 0.42, 'mod-t2': -0.2 } });
            registerVolatileStorageRuntime(() => {
                mutateCrdtDoc<Project>({
                    id: 'root',
                    changeFn: (document) => {
                        document.tracks.tracks.push(restoredTrack);
                    },
                });
                trackStore.hydrate();
                modulationStore.hydrate();
            }, ambiguous);
            const action =
                type === 'removeAllTracks' ? { type, payload: undefined } : { type, payload: { trackId: 't1' } };

            const result = await executeAppActionBatch([action]);

            expect(result.status).toBe(ambiguous ? 'ambiguous' : 'committed');
            expect(getCrdtDoc<Project>('root')?.tracks.tracks.map((candidate) => candidate.id)).toContain('t1');
            expect(documentModulators(getCrdtDoc<Project>('root')).some((modulator) => modulator.id === 'mod-t1')).toBe(
                false
            );
            expect(modulatorById('mod-t1')).toBeNull();
            expect(modulationRuntimeStore.value).toEqual({
                runtimeValues: type === 'removeAllTracks' ? {} : { 'mod-t2': -0.2 },
            });
        }
    );

    it.each([
        ['restored-modulator', false],
        ['restored-modulator', true],
        ['reused-modulator-id', false],
        ['reused-modulator-id', true],
        ['replacement-root', false],
        ['replacement-root', true],
    ] as const)('preserves the current modulation owner after %s, ambiguous=%s', async (replacement, ambiguous) => {
        const seeded = seedArrangement();
        const original = getCrdtDoc<Project>('root');
        const restoredTrack = seeded.tracks.tracks.find((candidate) => candidate.id === 't1');
        const restoredModulator = seeded.modulators.find((candidate) => candidate.id === 'mod-t1');
        if (!original || !restoredTrack || !restoredModulator) {
            throw new Error('Expected original modulation owner');
        }
        const successor = clone(original);
        modulationRuntimeStore.set({ runtimeValues: { 'mod-t1': 0.42, 'mod-t2': -0.2 } });
        registerVolatileStorageRuntime(() => {
            if (replacement === 'replacement-root') {
                replaceCrdtDoc({ id: 'root', doc: successor });
            } else {
                mutateCrdtDoc<Project>({
                    id: 'root',
                    changeFn: (document) => {
                        document.tracks.tracks.push(restoredTrack);
                        document.modulation.modulators.push({
                            ...restoredModulator,
                            trackId: replacement === 'reused-modulator-id' ? 'successor-track' : restoredTrack.id,
                        });
                    },
                });
            }
            trackStore.hydrate();
        }, ambiguous);

        const result = await executeAppActionBatch([{ type: 'removeAllTracks', payload: undefined }]);

        expect(result.status).toBe(ambiguous ? 'ambiguous' : 'committed');
        expect(documentModulators(getCrdtDoc<Project>('root')).map((modulator) => modulator.id)).toContain('mod-t1');
        expect(modulationRuntimeStore.value).toEqual({
            runtimeValues: replacement === 'replacement-root' ? { 'mod-t1': 0.42, 'mod-t2': -0.2 } : { 'mod-t1': 0.42 },
        });
    });

    it.each([
        [false, false],
        [false, true],
        [true, false],
        [true, true],
    ] as const)(
        'resets only a still-deleted exact mapping after track restoration, restoredMapping=%s, ambiguous=%s',
        async (restoredMapping, ambiguous) => {
            const seeded = seedArrangement();
            const originalTrack = seeded.tracks.tracks.find((candidate) => candidate.id === 't1');
            if (!originalTrack) {
                throw new Error('Expected original target track');
            }
            const restoredTrack = {
                ...originalTrack,
                devices: [
                    {
                        id: 'device-a',
                        name: 'Target',
                        type: 'bacteria',
                        bypassed: false,
                        parameterValues: { cutoff: 0.27 },
                    },
                ],
            };
            trackStore.set({
                ...seeded.tracks,
                tracks: seeded.tracks.tracks.map((candidate) => (candidate.id === 't1' ? restoredTrack : candidate)),
            });
            flushAutomergeStorageWrites();
            registerVolatileStorageRuntime(() => {
                mutateCrdtDoc<Project>({
                    id: 'root',
                    changeFn: (document) => {
                        document.tracks.tracks.push(restoredTrack);
                        if (restoredMapping) {
                            const currentModulator = document.modulation.modulators.find(
                                (candidate) => candidate.id === 'mod-t2'
                            );
                            if (!currentModulator) {
                                throw new Error('Expected surviving modulation owner');
                            }
                            currentModulator.mappings.push({
                                targetTrackId: 't1',
                                targetDeviceId: 'device-a',
                                targetParamId: 'cutoff',
                                amount: 0.9,
                            });
                        }
                    },
                });
                trackStore.hydrate();
            }, ambiguous);

            const result = await executeAppActionBatch([{ type: 'removeTrack', payload: { trackId: 't1' } }]);

            expect(result.status).toBe(ambiguous ? 'ambiguous' : 'committed');
            const mappings = documentModulators(getCrdtDoc<Project>('root')).find(
                (modulator) => modulator.id === 'mod-t2'
            )?.mappings;
            expect(mappings?.some((mapping) => mapping.targetTrackId === 't1')).toBe(restoredMapping);
            if (restoredMapping) {
                expect(writeModulationParam).not.toHaveBeenCalled();
            } else {
                expect(writeModulationParam).toHaveBeenCalledExactlyOnceWith('t1', 'device-a', 'cutoff', 0.27);
            }
        }
    );

    it('undo restores the captured modulation and redo removes it again', async () => {
        seedArrangement();
        const captured = structuredClone(liveModulators());

        await executeAppActionBatch([{ type: 'removeAllTracks', payload: undefined }]);
        expect(liveModulators()).toEqual([]);

        await undo();
        flushAutomergeStorageWrites();

        expect(trackStore.value?.tracks.map((candidate) => candidate.id)).toEqual(['t1', 't2', 't3']);
        expect(liveModulators()).toEqual(captured);
        expect(documentModulators(getCrdtDoc<Project>('root'))).toEqual(captured);

        await redo();
        flushAutomergeStorageWrites();

        expect(trackStore.value?.tracks).toEqual([]);
        expectNoDeletedTrackReferences(['t1', 't2', 't3']);
        expect(documentModulators(getCrdtDoc<Project>('root'))).toEqual([]);
    });

    it('refused transaction retains the prior modulation truth and its runtime', async () => {
        const seeded = seedArrangement();
        modulationRuntimeStore.set({ runtimeValues: { 'mod-t1': 0.42 } });

        // removeAllTracks is a domain-singleton action, so a refusal cannot come
        // from a sibling action; the production refusal route for the batch is
        // its postcondition validation. The handler executes fully — removing
        // tracks and modulation references with DEFERRED runtime effects — and
        // the refused postcondition aborts the transaction before any commit,
        // so the deferred finalizers never run.
        const result = await executeAppActionBatch([{ type: 'removeAllTracks', payload: undefined }], {
            prepareValidation: () => ({
                status: 'ready',
                postconditions: { documentId: 'root', validate: () => 'spec refusal' },
            }),
        });

        expect(result.status).toBe('conflicted');
        // Read the committed document directly: a flush here would push the
        // stale live-store projection over it, the opposite of what a refusal
        // guarantees.
        const refusedDocument = getCrdtDoc<Project>('root');
        if (!refusedDocument) {
            throw new Error('Expected the project document');
        }
        expect(documentModulators(refusedDocument)).toEqual(seeded.modulators);
        expect(refusedDocument.tracks.tracks.map((candidate) => candidate.id)).toEqual(['t1', 't2', 't3']);
        // No precommit runtime teardown: the deferred finalizers ride the
        // commit, which never happened.
        expect(modulationRuntimeStore.value).toEqual({ runtimeValues: { 'mod-t1': 0.42 } });

        // Durable truth is intact. Restoring the live projection from it (what
        // the projection bridge does on a refused transaction) leaves a state a
        // later removal still sweeps completely.
        trackStore.set(seeded.tracks);
        modulationStore.set({ modulators: structuredClone(seeded.modulators) });
        const retry = await executeAppActionBatch([{ type: 'removeAllTracks', payload: undefined }]);
        expect(retry.status).toBe('committed');
        expectNoDeletedTrackReferences(['t1', 't2', 't3']);
    });

    it('preserves a peer modulation change made between the delete and the undo', async () => {
        seedArrangement();

        await executeAppActionBatch([{ type: 'removeAllTracks', payload: undefined }]);
        expect(liveModulators()).toEqual([]);

        // A peer adds its own track and modulator straight into the document;
        // the inbound edit carries no local undo entry.
        const peerModulator = {
            id: 'mod-peer',
            name: 'Peer LFO',
            trackId: 'peer-track',
            kind: 'lfo',
            config: { kind: 'lfo', waveform: 'saw', rate: 2, sync: false, phase: 0, depth: 0.25 },
            mappings: [],
            enabled: true,
        } as Modulator;
        const peerTrack = TrackDummy.create({ id: 'peer-track', kind: 'audio' });
        const project = getCrdtDoc<Project>('root');
        if (!project) {
            throw new Error('Expected the project document');
        }
        project.tracks.tracks.push(peerTrack);
        project.modulation.modulators.push(peerModulator);
        const liveTracks = trackStore.value?.tracks ?? [];
        trackStore.set({
            tracks: [...liveTracks, peerTrack],
            selectedTrackId: trackStore.value?.selectedTrackId ?? null,
            ghostClips: [],
        });
        modulationStore.set({ modulators: [...liveModulators(), peerModulator] });
        flushAutomergeStorageWrites();

        await undo();
        flushAutomergeStorageWrites();

        expect(modulatorById('mod-peer')).toMatchObject({ trackId: 'peer-track' });
        expectPriorModulationTruth();
        expect(trackStore.value?.tracks.map((candidate) => candidate.id)).toEqual(
            expect.arrayContaining(['t1', 't2', 't3', 'peer-track'])
        );

        await redo();
        flushAutomergeStorageWrites();

        // The redo removed the peer's track too, so the peer modulator went
        // with its owner — and no deleted references may remain either way.
        expect(trackStore.value?.tracks.map((candidate) => candidate.id)).not.toContain('peer-track');
        expectNoDeletedTrackReferences(['t1', 't2', 't3', 'peer-track']);
    });
});
