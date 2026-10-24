import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';

const CREATED_AT = 1_700_000_000_000;
const PCM = [0.25, -0.5, 0.75];
const BUDGET = 2 * 1024 * 1024 * 1024;
type Sweep = 'freeze' | 'age' | 'size';
type Location = 'active' | 'inactive arrangement' | 'inactive alternative';

function deferred<T>() {
    let settle!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        settle = resolve;
    });
    return { promise, resolve: settle };
}

function pcm(): AudioBuffer {
    const channel = new Float32Array(PCM);
    return {
        copyFromChannel: (destination) => destination.set(channel),
        copyToChannel: (source) => channel.set(source),
        duration: channel.length / 48_000,
        getChannelData: () => channel,
        length: channel.length,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
}

async function importModules() {
    const [
        audio,
        cache,
        project,
        projectStores,
        command,
        commandStores,
        crdt,
        arrangement,
        tracks,
        trackDummy,
        clipDummy,
    ] = await Promise.all([
        import('#/modules/AudioEngine/useCases'),
        import('#/modules/AudioEngine/stores'),
        import('#/modules/Project/useCases'),
        import('#/modules/Project/stores'),
        import('#/modules/Command/useCases'),
        import('#/modules/Command/stores'),
        import('#/modules/CrdtDocument/useCases'),
        import('../../getArrangementHandlers'),
        import('../../../stores/trackStore'),
        import('../../../__tests__/TrackDummy'),
        import('../../../__tests__/ClipDummy'),
    ]);
    return {
        audio,
        cache,
        project,
        projectStores,
        command,
        commandStores,
        crdt,
        arrangement,
        tracks,
        trackDummy,
        clipDummy,
    };
}

let modules: Awaited<ReturnType<typeof importModules>>;
let installation: TransactionalIndexedDbInstallation;
let database: IDBDatabase | undefined;

function audioDatabase(): IDBDatabase {
    if (!database) {
        throw new Error('Expected production audio IndexedDB connection');
    }
    return database;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.addEventListener('complete', () => resolve(), { once: true });
        transaction.addEventListener(
            'abort',
            () => reject(transaction.error ?? new Error('Audio transaction aborted')),
            { once: true }
        );
        transaction.addEventListener(
            'error',
            () => reject(transaction.error ?? new Error('Audio transaction failed')),
            { once: true }
        );
    });
}

async function storedPcm(id: string): Promise<unknown> {
    const transaction = audioDatabase().transaction('buffers', 'readonly');
    const request = transaction.objectStore('buffers').get(id) as IDBRequest<unknown>;
    let value: unknown;
    request.addEventListener('success', () => {
        value = request.result;
    });
    await transactionDone(transaction);
    return value;
}

async function setCollectionMetadata(id: string, sweep: Sweep, overBudget = false): Promise<void> {
    // Exercise real collector thresholds with tiny PCM. A fresh stamp or a
    // below-budget cache cannot expose the independent age and size routes.
    const transaction = audioDatabase().transaction('bufferMeta', 'readwrite');
    const store = transaction.objectStore('bufferMeta');
    const request = store.get(id) as IDBRequest<Record<string, unknown> | undefined>;
    request.addEventListener('success', () => {
        if (!request.result) {
            transaction.abort();
            return;
        }
        store.put(
            {
                ...request.result,
                lastAccessed:
                    sweep === 'age' ? Date.now() - 31 * 24 * 60 * 60 * 1000 : Date.now() - (overBudget ? 0 : 1000),
                sizeInBytes: overBudget ? BUDGET + 1 : PCM.length * Float32Array.BYTES_PER_ELEMENT,
                freezeProjectId: CREATED_AT,
            },
            id
        );
    });
    await transactionDone(transaction);
}

async function persistPcm(id: string, sweep: Sweep, overBudget = false): Promise<void> {
    modules.cache.audioBufferCache.set(id, pcm(), { freezeProjectId: CREATED_AT });
    const receipt = await modules.cache.audioBufferCache.ensureDurable([id]);
    expect(receipt.status).toBe('durable');
    if (receipt.status !== 'durable') {
        throw new Error(`PCM fixture is ${receipt.status}`);
    }
    receipt.release();
    await setCollectionMetadata(id, sweep, overBudget);
}

async function sweep(sweep: Sweep): Promise<void> {
    if (sweep === 'freeze') {
        await modules.audio.garbageCollectFreezeAudioBuffers({ activeBufferIds: new Set(), projectId: CREATED_AT });
    } else if (sweep === 'age') {
        await modules.audio.garbageCollectCachedAudioBuffersByAge({ maxAgeDays: 30 });
    } else {
        await modules.audio.garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: BUDGET });
    }
}

function currentTrack() {
    const track = modules.tracks.trackStore.value?.tracks[0];
    if (!track) {
        throw new Error('Expected current track');
    }
    return track;
}

async function flatten(id: string, location: Location): Promise<void> {
    const original = modules.trackDummy.TrackDummy.create({
        id: 'track-gc',
        kind: 'midi',
        frozen: true,
        frozenBufferId: id,
        freezeState: {
            status: 'frozen',
            frozenBufferId: id,
            renderSettings: { sampleRate: 48_000, bitDepth: 32, channelCount: 1, tailLengthSeconds: 0 },
        },
        clips: [
            modules.clipDummy.ClipDummy.create({
                id: 'original',
                trackId: 'track-gc',
                type: 'midi',
                audioBufferId: undefined,
            }),
        ],
    });
    modules.tracks.trackStore.set({ tracks: [original], selectedTrackId: original.id });
    flushAutomergeStorageWrites();
    await modules.command.executeAppAction(
        { type: 'flattenTrack', payload: { trackId: original.id } },
        { source: 'manual' }
    );
    const flattened = currentTrack();
    expect(flattened.clips[0]?.audioBufferId).toBe(id);
    expect(flattened.freezeState.status).toBe('unfrozen');
    const truth = modules.crdt.getCrdtDoc<{ tracks?: { tracks?: { clips?: { audioBufferId?: string }[] }[] } }>('root');
    expect(truth?.tracks?.tracks?.[0]?.clips?.[0]?.audioBufferId).toBe(id);
    if (location === 'inactive arrangement') {
        modules.projectStores.arrangementStore.set({
            activeArrangementId: 'active',
            arrangements: [
                {
                    id: 'inactive',
                    name: 'Inactive',
                    tracks: { tracks: [flattened], selectedTrackId: null },
                    automation: { lanes: [] },
                    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                },
            ],
        });
        modules.tracks.trackStore.set({ tracks: [], selectedTrackId: null });
    } else if (location === 'inactive alternative') {
        modules.tracks.trackStore.set({
            tracks: [
                {
                    ...flattened,
                    clips: [],
                    activeAlternativeId: 'empty',
                    alternatives: [...flattened.alternatives, { id: 'empty', name: 'Empty', clips: [] }],
                },
            ],
            selectedTrackId: flattened.id,
        });
    }
    flushAutomergeStorageWrites();
}

async function expectRetained(id: string): Promise<void> {
    const stored = await storedPcm(id);
    if (stored === undefined || stored === null || typeof stored !== 'object') {
        throw new Error(`Expected durable PCM for ${id}; received ${String(stored)}`);
    }
    const channelData: unknown = Reflect.get(stored, 'channelData');
    const channel: unknown = Array.isArray(channelData) ? channelData[0] : undefined;
    if (!isFloat32Array(channel)) {
        throw new Error(`Expected a stored Float32Array channel for ${id}`);
    }
    expect(Array.from(channel)).toEqual(PCM);
    expect(modules.cache.audioBufferCache.has(id)).toBe(true);
    const receipt = await modules.cache.audioBufferCache.ensureDurable([id]);
    expect(receipt.status).toBe('durable');
    if (receipt.status === 'durable') {
        receipt.release();
    }
}

function isFloat32Array(value: unknown): value is Float32Array {
    return Object.prototype.toString.call(value) === '[object Float32Array]';
}

describe('unsaved flattened audio collection', () => {
    beforeAll(async () => {
        window.localStorage.clear();
        installation = installTransactionalIndexedDb();
        database = undefined;
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        const open = indexedDB.open.bind(indexedDB);
        vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
            const request = version === undefined ? open(name) : open(name, version);
            if (name === 'sourdaw-audio') {
                request.addEventListener(
                    'success',
                    () => {
                        database = request.result;
                    },
                    { once: true }
                );
            }
            return request;
        });
        modules = await importModules();
    }, 30_000);

    beforeEach(() => {
        modules.crdt.resetCrdtProjectAuthority('Unsaved audio collection');
        modules.crdt.registerCrdtStorageRuntime();
        modules.commandStores.clearHandlerRegistry();
        modules.commandStores.registerHandlerMap(modules.arrangement.getArrangementHandlers());
        modules.command.clearUndoHistory();
        modules.projectStores.projectLoadFailureStore.set(null);
        const project = modules.projectStores.projectStore.value;
        if (!project) {
            throw new Error('Expected initialized project store');
        }
        modules.projectStores.projectStore.set({
            ...project,
            createdAt: CREATED_AT,
            loading: false,
            initialized: true,
        });
        modules.projectStores.arrangementStore.set({ activeArrangementId: 'active', arrangements: [] });
        modules.tracks.trackStore.set({ tracks: [], selectedTrackId: null });
        modules.audio.configureDurableAudioBufferOwnership(modules.project.collectDurableOwnedAudioBufferIds);
        flushAutomergeStorageWrites();
    });

    afterEach(async () => {
        modules.audio.configureDurableAudioBufferOwnership(null);
        modules.command.clearUndoHistory();
        modules.commandStores.clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        modules.crdt.removeCrdtDoc('root');
        Container.clear();
        window.localStorage.clear();
    });

    afterAll(async () => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        await installation.dispose();
    });

    for (const collector of ['freeze', 'age', 'size'] as const) {
        for (const location of ['active', 'inactive arrangement', 'inactive alternative'] as const) {
            it(`${collector} retains actual unsaved flattened PCM in the ${location} while removing an orphan`, async () => {
                const id = `freeze-${collector}-${location}-owned`;
                const orphan = `freeze-${collector}-${location}-orphan`;
                await persistPcm(id, collector);
                await persistPcm(orphan, collector, collector === 'size');
                await flatten(id, location);
                // Flatten reads its input and refreshes the access stamp; set
                // the intended age/size census again after that real read.
                await setCollectionMetadata(id, collector);
                await sweep(collector);
                expect(await storedPcm(orphan)).toBeUndefined();
                await expectRetained(id);
            });
        }

        it(`${collector} refuses a held census after a typed clip write gains an owner`, async () => {
            const id = `freeze-${collector}-late-owner`;
            await persistPcm(id, collector);
            if (collector === 'size') {
                await persistPcm('freeze-size-pressure', collector, true);
            }
            modules.tracks.trackStore.set({
                tracks: [modules.trackDummy.TrackDummy.create({ id: 'track-gc' })],
                selectedTrackId: 'track-gc',
            });
            flushAutomergeStorageWrites();
            const captured = deferred<void>();
            const release = deferred<void>();
            modules.audio.configureDurableAudioBufferOwnership(async () => {
                const census = await modules.project.collectDurableOwnedAudioBufferIds();
                captured.resolve();
                await release.promise;
                return census;
            });
            const collection = sweep(collector);
            await captured.promise;
            try {
                await modules.command.executeAppAction(
                    {
                        type: 'addClip',
                        payload: {
                            trackId: 'track-gc',
                            name: 'Late owner',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'audio',
                            audioBufferId: id,
                        },
                    },
                    { source: 'manual' }
                );
                expect(currentTrack().clips[0]?.audioBufferId).toBe(id);
            } finally {
                release.resolve();
                await collection;
            }
            await expectRetained(id);
        });
    }
});
