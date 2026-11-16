import { Blob as NativeBlob } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { performance as nativePerformance, PerformanceObserver } from 'node:perf_hooks';
import { MessageChannel } from 'node:worker_threads';

import * as A from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectLifecycle } from '#/app/registerProjectLifecycle';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import {
    captureAutomergeStoragePreparationScope,
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { getWarpState, trackStore } from '#/modules/Arrangement/stores';
import { addClip, addTrack, hydrateClipWarpStates, renameTrack } from '#/modules/Arrangement/useCases';
import {
    exportSdawFile,
    getCrdtDoc,
    getCrdtDocIds,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
    subscribeToCrdtChanges,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { valuesEqual } from '#/utils/structuralEquality';

import { NativePreparationWorker, settleNativePreparationWorkers } from '../../__tests__/nativePreparationWorker';
import { takeSnapshot } from '../../useCases/arrangement/takeSnapshot';
import { createFreshProjectMetadata } from '../../useCases/createFreshProjectMetadata';
import { resetModuleStoresToDefault } from '../../useCases/projectPersistence/helpers/resetModuleStoresToDefault';
import { arrangementStore, prepareArrangementStoreState } from '../arrangementStore';
import { projectStore } from '../projectStore';

type NativeRoot = {
    [key: string]: unknown;
    tracks?: { tracks: { name: string }[] };
    actionHistory?: {
        entries: {
            id: string;
            label: string;
            timestamp: number;
            source: string;
            actionKind: string;
            reverted: boolean;
        }[];
    };
    projectMeta?: Record<string, unknown>;
};

function root() {
    const document = getCrdtDoc<NativeRoot>('root');
    if (!document) {
        throw new Error('Actual native project root is missing');
    }
    return document;
}

function requireValue<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) {
        throw new Error('Fixture owner refused its valid input');
    }
    return value;
}

function seedDenseProject(): void {
    resetCrdtProjectAuthority('Native preparation');
    resetModuleStoresToDefault();
    projectStore.set(createFreshProjectMetadata({ name: 'Native preparation', initialized: true, loading: false }));
    requireValue(addTrack({ id: 'scale-track-0', name: 'Source', kind: 'audio' }));
    requireValue(
        addClip({
            id: 'source',
            trackId: 'scale-track-0',
            name: '120 second source',
            type: 'audio',
            startBeat: 0,
            endBeat: 240,
            audioBufferId: 'source-pcm',
        })
    );
    arrangementStore.set({
        arrangements: [takeSnapshot('active', 'Active'), takeSnapshot('inactive', 'Inactive')],
        activeArrangementId: 'active',
    });
    flushAutomergeStorageWrites();
    // Retain real native edits while the fixture is small. This is a native
    // history fixture, not a claim that Command replay was exercised here.
    let history = A.clone(root());
    for (let index = 0; index < 2048; index++) {
        history = A.change(history, { message: `Retained edit ${index}`, time: 0 }, (draft) => {
            const track = draft.tracks?.tracks[0];
            if (!track) {
                throw new Error('Native history fixture lost its real source track');
            }
            track.name = `Retained edit ${index}`;
            draft.actionHistory ??= { entries: [] };
            const rows = draft.actionHistory.entries;
            rows.push({
                id: `history-${index}`,
                label: `Edit ${index}`,
                timestamp: index,
                source: 'manual',
                actionKind: 'renameTrack',
                reverted: false,
            });
            if (rows.length > 200) {
                rows.splice(0, rows.length - 200);
            }
        });
    }
    replaceCrdtDoc({ id: 'root', doc: history });
    projectCrdtToStores({ resetProjections: true });
    for (let trackIndex = 0; trackIndex < 32; trackIndex++) {
        const trackId = `scale-track-${trackIndex}`;
        const audio = trackIndex < 16;
        if (trackIndex > 0) {
            requireValue(addTrack({ id: trackId, name: `Scale ${trackIndex}`, kind: audio ? 'audio' : 'midi' }));
        }
        for (let clipIndex = 0; clipIndex < 8; clipIndex++) {
            if (trackIndex === 0 && clipIndex === 0) {
                continue;
            }
            const length = audio ? 240 : 32;
            const payload: Parameters<typeof addClip>[0] = {
                id: `scale-clip-${trackIndex}-${clipIndex}`,
                trackId,
                name: `Phrase ${clipIndex}`,
                type: audio ? 'audio' : 'midi',
                startBeat: clipIndex * length,
                endBeat: (clipIndex + 1) * length,
            };
            if (audio) {
                payload.audioBufferId = 'source-pcm';
            }
            requireValue(addClip(payload));
        }
        flushAutomergeStorageWrites();
    }
    const notesByClipId: NonNullable<typeof midiStore.value>['notesByClipId'] = {};
    for (let trackIndex = 16; trackIndex < 32; trackIndex++) {
        for (let clipIndex = 0; clipIndex < 8; clipIndex++) {
            notesByClipId[`scale-clip-${trackIndex}-${clipIndex}`] = Array.from({ length: 64 }, (_, note) => ({
                id: `note-${trackIndex}-${clipIndex}-${note}`,
                pitch: 48 + ((note + trackIndex) % 24),
                startBeat: note / 2,
                duration: 0.375,
                velocity: 0.5 + (note % 5) / 10,
            }));
        }
    }
    setMidiStoreState({ notesByClipId, ccByClipId: {}, pitchBendByClipId: {}, noteCoordinateFormat: 'clip-relative' });
    hydrateClipWarpStates(
        Array.from({ length: 8 }, (_, index) => ({
            clipId: `scale-clip-${index + 1}-0`,
            ...getWarpState('source'),
            enabled: true,
            markers: Array.from({ length: 120 }, (_, marker) => ({
                id: `marker-${index}-${marker}`,
                originalBeat: marker * 2,
                warpedBeat: marker * 2,
                origin: 'transient-auto',
                confidence: 1,
                locked: false,
            })),
        }))
    );
    flushAutomergeStorageWrites();
    arrangementStore.hydrate();
}

beforeEach(() => {
    registerProjectLifecycle();
    registerProjectSlotProjections();
    registerCrdtStorageRuntime();
    vi.stubGlobal('Worker', NativePreparationWorker);
    vi.stubGlobal('MessageChannel', MessageChannel);
    vi.stubGlobal('performance', nativePerformance);
    vi.stubGlobal('Blob', NativeBlob);
});
afterEach(async () => {
    await settleNativePreparationWorkers();
    configureAutomergeStoragePort(null);
    vi.unstubAllGlobals();
});

describe('arrangementStore real bounded native preparation', () => {
    it('admits a dense private sequence and separately stages and commits one native publication', async () => {
        const timings: { name: string; duration: number; detail?: unknown }[] = [];
        const cancellation = new AbortController();
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.name.startsWith('automerge-')) {
                    timings.push({ name: entry.name, duration: entry.duration, detail: entry.detail });
                    if (
                        (entry.name.includes('sequence-slice') || entry.name.includes('sequence-planning')) &&
                        entry.duration >= 50
                    ) {
                        cancellation.abort(
                            new Error(`Actual native preparation task exceeded50ms: ${entry.name} ${entry.duration}`)
                        );
                    }
                }
            }
        });
        observer.observe({ entryTypes: ['measure'] });
        const timed = <T>(name: string, callback: () => T): T => {
            const started = performance.now();
            try {
                return callback();
            } finally {
                timings.push({ name, duration: performance.now() - started });
            }
        };
        seedDenseProject();
        const original = root();
        const originalTruth = A.toJS(original);
        const history = A.getChangesMetaSince(original, []);
        const heads = A.getHeads(original);
        const actor = A.getActorId(original);
        expect(history.length).toBeGreaterThanOrEqual(2048);
        expect(trackStore.value?.tracks).toHaveLength(32);
        expect(trackStore.value?.tracks.flatMap((track) => track.clips)).toHaveLength(256);
        expect(Object.values(requireValue(midiStore.value).notesByClipId).flat()).toHaveLength(8192);
        for (let index = 0; index < 8; index++) {
            expect(getWarpState(`scale-clip-${index + 1}-0`).markers).toHaveLength(120);
        }
        const originalState = requireValue(arrangementStore.value);
        const target = {
            ...originalState,
            arrangements: originalState.arrangements.map((snapshot) =>
                snapshot.id === 'active' ? takeSnapshot(snapshot.id, snapshot.name) : snapshot
            ),
        };
        // The intended stored JSON omits undefined snapshot fields; native authority stays raw.
        const intendedSlotJson = JSON.stringify(target);
        const canonicalTarget: unknown = JSON.parse(intendedSlotJson);
        const control = A.clone(original);
        const cursor = A.saveIncremental(control);
        A.free(control);
        expect(cursor.length).toBeGreaterThan(0);
        const transaction = runWithAutomergeStorageTransaction(undefined, captureAutomergeStoragePreparationScope);
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        const plan = timed('owner-planning', () =>
            requireValue(prepareArrangementStoreState(transaction.value, target))
        );
        const nativePublications: string[][] = [];
        const unsubscribe = subscribeToCrdtChanges(() => nativePublications.push(A.getHeads(root())));
        const projectedHeads: string[][] = [];
        const unstore = arrangementStore.subscribe(() => projectedHeads.push(A.getHeads(root())));
        try {
            timed('owner-clone', () => plan.clone());
            if (!plan.requestMaterialization) {
                throw new Error('Native preparation has no request route');
            }
            await plan.requestMaterialization(cancellation.signal);
            expect(root()).toBe(original);
            expect(nativePublications).toHaveLength(0);
            timed('owner-materialize', () => transaction.scope(() => plan.materialize()));
            timed('owner-stage', () =>
                transaction.scope(() => {
                    expect(plan.stage()).toBe(true);
                    const metadata = requireValue(projectStore.value);
                    projectStore.set({ ...metadata, updatedAt: metadata.updatedAt + 1, dirty: true });
                })
            );
            expect(nativePublications).toHaveLength(0);
            expect(projectedHeads.length).toBeGreaterThan(0);
            expect(projectedHeads.every((value) => valuesEqual(value, heads))).toBe(true);
            transaction.validateDocument('root', (document) =>
                valuesEqual(document.arrangements, canonicalTarget) ? null : 'Target changed'
            );
            timed('owner-commit', () => transaction.commit());
            expect(nativePublications).toHaveLength(1);
            const updated = root();
            expect(A.getActorId(updated)).toBe(actor);
            expect(A.getMissingDeps(updated, heads)).toEqual([]);
            expect(A.getChangesMetaSince(updated, []).slice(0, history.length)).toEqual(history);
            const finalTruth = A.toJS(updated);
            expect(finalTruth).toEqual({
                ...originalTruth,
                arrangements: canonicalTarget,
                projectMeta: { ...originalTruth.projectMeta, updatedAt: requireValue(projectStore.value).updatedAt },
            });
            expect(A.saveIncremental(original)).toEqual(cursor);
            const entries = observer.takeRecords();
            for (const entry of entries) {
                if (entry.name.startsWith('automerge-')) {
                    timings.push({ name: entry.name, duration: entry.duration, detail: entry.detail });
                }
            }
            const additions = A.getChangesMetaSince(updated, heads);
            expect(additions.length).toBeGreaterThan(1);
            const supplemental = requireValue(additions.at(-1));
            const primaryLast = requireValue(additions.at(-2));
            expect(supplemental.deps).toEqual([primaryLast.hash]);
            const supplementalBytes = A.getChangesSince(updated, supplemental.deps);
            expect(supplementalBytes).toHaveLength(1);
            const decodedSupplemental = A.decodeChange(requireValue(supplementalBytes[0]));
            expect(decodedSupplemental.hash).toBe(supplemental.hash);
            expect(decodedSupplemental.actor).toBe(actor);
            expect(decodedSupplemental.ops).toEqual([
                expect.objectContaining({
                    action: 'set',
                    obj: requireValue(A.getObjectId(updated.projectMeta)),
                    key: 'updatedAt',
                    value: requireValue(projectStore.value).updatedAt,
                }),
            ]);
            const nativeChunkCount = additions.length - 1;
            const expectedIndices = Array.from({ length: nativeChunkCount }, (_, index) => index);
            for (const phase of [
                'automerge-prospective-sequence-slice-task',
                'automerge-prospective-response-task',
                'automerge-prospective-apply-task',
                'automerge-prospective-authority-task',
            ]) {
                const records = timings.filter((entry) => entry.name === phase);
                expect(records, phase).toHaveLength(nativeChunkCount);
                const indices = records.map(({ detail }) => {
                    if (typeof detail !== 'object' || detail === null || !('sequenceIndex' in detail)) {
                        throw new Error(`Missing actual native sequence index for ${phase}`);
                    }
                    return detail.sequenceIndex;
                });
                expect(indices, phase).toEqual(expectedIndices);
            }
            expect(
                timings.filter((entry) => entry.name === 'automerge-prospective-sequence-planning-task')
            ).toHaveLength(1);
            for (const phase of [
                'automerge-storage-materialization-handoff-task',
                'automerge-storage-prepared-publication',
            ]) {
                const records = timings.filter((entry) => entry.name === phase);
                expect(records, phase).toHaveLength(1);
                expect(records[0]?.detail).toEqual({
                    preparationPolicy: 'bounded-native-sequence-v1',
                    primaryKey: 'arrangements',
                });
            }
            const critical = timings.filter(
                (entry) =>
                    entry.name.startsWith('owner-') ||
                    entry.name.includes('sequence-slice') ||
                    entry.name.includes('sequence-planning')
            );
            expect(
                critical.every((entry) => entry.duration < 50),
                JSON.stringify(critical.filter((entry) => entry.duration >= 50))
            ).toBe(true);
            const beforeLater = A.getChangesMetaSince(updated, []);
            renameTrack('scale-track-0', 'Later owner edit');
            flushAutomergeStorageWrites();
            expect(
                A.getChangesMetaSince(
                    root(),
                    beforeLater.map((entry) => entry.hash)
                ).length
            ).toBeGreaterThan(0);
            const exportStarted = performance.now();
            const blob = exportSdawFile();
            timings.push({ name: 'diagnostic-exportSdawFile', duration: performance.now() - exportStarted });
            const arrayStarted = performance.now();
            const binary = await blob.arrayBuffer();
            timings.push({
                name: 'diagnostic-Blob-arrayBuffer',
                duration: performance.now() - arrayStarted,
                detail: { bytes: binary.byteLength, documents: getCrdtDocIds() },
            });
            expect(binary.byteLength).toBeGreaterThan(0);
        } finally {
            transaction.abort();
            plan.discard();
            unstore();
            unsubscribe();
            for (const entry of observer.takeRecords()) {
                if (entry.name.startsWith('automerge-')) {
                    timings.push({ name: entry.name, duration: entry.duration, detail: entry.detail });
                }
            }
            observer.disconnect();
            if (process.env.SOURDAW_SEQUENCE_DIAGNOSTIC) {
                writeFileSync(process.env.SOURDAW_SEQUENCE_DIAGNOSTIC, JSON.stringify({ timings }, null, 2));
            }
        }
    }, 70_000);
});
