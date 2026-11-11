import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { createHash } from 'node:crypto';

import { toJS } from '@automerge/automerge';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { createEventBus } from '#/infra/events/createEventBus';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setClipAudioAssetStager } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    cacheAudioBuffer,
    clearRuntimeCachedAudioBuffers,
    configureDurableAudioBufferOwnership,
    configureLiveAudioBufferReferences,
    getCachedAudioBuffer,
    getAudioContext,
} from '#/modules/AudioEngine/useCases';
import { audioBufferToWav, stageAudioBufferAsset } from '#/modules/AudioRendering/useCases';
import { configureCollaborationAssetOwner, getAssetTransfer } from '#/modules/Collaboration/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { libraryStore } from '#/modules/SampleLibrary/stores';
import {
    setNotificationEventBus,
    type NotifyPayload,
    type ConfirmPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { placeLibrarySample } from '../placeLibrarySample';

const filesystem = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('#/modules/SampleLibrary/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/SampleLibrary/useCases')>()),
    resolveDroppedSampleFile: filesystem.read,
}));

const factoryRender = vi.hoisted(() => vi.fn());
vi.mock('#/modules/FactorySynthesis/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/FactorySynthesis/useCases')>()),
    renderFactorySamples: factoryRender,
}));

const batchAdmission = vi.hoisted(() => ({
    pressure: undefined as (() => void) | undefined,
    actions: [] as unknown[],
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    const executeBatch: typeof actual.executeAppActionBatch = (actions, options) => {
        batchAdmission.actions.push(actions);
        return actual.executeAppActionBatch(actions, {
            ...options,
            shouldExecute: () => {
                batchAdmission.pressure?.();
                return options?.shouldExecute?.() ?? true;
            },
        });
    };
    return { ...actual, executeAppActionBatch: executeBatch };
});

// Web Audio is the external boundary; each declared frame has coherent PCM.
class PcmBuffer implements AudioBuffer {
    readonly duration: number;
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    private readonly channels: Float32Array<ArrayBuffer>[];

    constructor({ length, numberOfChannels = 1, sampleRate }: AudioBufferOptions) {
        this.length = length;
        this.numberOfChannels = numberOfChannels;
        this.sampleRate = sampleRate;
        this.duration = length / sampleRate;
        this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    }

    getChannelData(channel: number): Float32Array<ArrayBuffer> {
        return this.channels[channel]!;
    }
    copyToChannel(source: Float32Array<ArrayBuffer>, channel: number, offset = 0): void {
        this.channels[channel]!.set(source, offset);
    }
    copyFromChannel(destination: Float32Array<ArrayBuffer>, channel: number, offset = 0): void {
        destination.set(this.channels[channel]!.subarray(offset, offset + destination.length));
    }
}

type Root = { tracks: { tracks: Track[] } };
type NotificationEvents = { 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload };
const BUFFER_ID = 'audio-imported-stereo-original';
const NAME = 'Imported stereo original';
const STORAGE_LOCK = 'sourdaw:project-audio-storage';
const CAPACITY = 64;
let burst = 0;

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((_resolve) => {
        resolve = _resolve;
    });
    return { promise, resolve };
}

function originalPcm(): AudioBuffer {
    const buffer = new PcmBuffer({ length: 7, numberOfChannels: 2, sampleRate: 48_000 });
    buffer.copyToChannel(new Float32Array([0.125, -0.75, 0.5, 0, 0.9375, -0.03125, 0.25]), 0);
    buffer.copyToChannel(new Float32Array([-0.5, 0.25, 0.0625, -0.875, 0.375, 0.75, -0.125]), 1);
    return buffer;
}

function evictUnprotected(): void {
    burst += 1;
    for (let index = 0; index < CAPACITY; index += 1) {
        cacheAudioBuffer({
            bufferId: `unrelated-${burst}-${index}`,
            buffer: new PcmBuffer({ length: 1, sampleRate: 48_000 }),
        });
    }
}

function rootTracks(): Track[] {
    const root = getCrdtDoc<Root>('root');
    if (!root) {
        throw new Error('Expected project authority');
    }
    return toJS(root).tracks.tracks;
}

function projectedTracks(): Track[] {
    const state = trackStore.value;
    if (!state) {
        throw new Error('Expected track projection');
    }
    return state.tracks;
}

function history() {
    const state = undoHistoryStore.value;
    if (!state) {
        throw new Error('Expected actual Command history');
    }
    return state;
}

function expectOriginalPcm(original: AudioBuffer, bufferId = BUFFER_ID): void {
    const actual = getCachedAudioBuffer({ bufferId });
    if (!actual) {
        throw new Error('Original imported PCM is unavailable');
    }
    expect(actual.length).toBe(7);
    expect(actual.sampleRate).toBe(48_000);
    expect(actual.numberOfChannels).toBe(2);
    for (let channel = 0; channel < 2; channel += 1) {
        expect(actual.getChannelData(channel)).toStrictEqual(original.getChannelData(channel));
    }
}

function expectStagedOriginal(bytes: ArrayBuffer, original: AudioBuffer): void {
    const view = new DataView(bytes);
    const text = (offset: number, length: number) => new TextDecoder().decode(new Uint8Array(bytes, offset, length));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 8)).toBe('WAVEfmt ');
    expect(text(36, 4)).toBe('data');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(7 * 2 * 2);
    expect(bytes.byteLength).toBe(44 + 7 * 2 * 2);
    for (let frame = 0; frame < 7; frame += 1) {
        for (let channel = 0; channel < 2; channel += 1) {
            const encoded = view.getInt16(44 + (frame * 2 + channel) * 2, true) / 32768;
            expect(Math.abs(encoded - original.getChannelData(channel)[frame]!)).toBeLessThanOrEqual(2 / 32768);
        }
    }
}

async function readStoredOriginal(): Promise<unknown> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('sourdaw-audio');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        return await new Promise<unknown>((resolve, reject) => {
            const request = database.transaction('buffers', 'readonly').objectStore('buffers').get(BUFFER_ID);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        database.close();
    }
}

async function holdStorageWrites() {
    const entered = deferred<void>();
    const release = deferred<void>();
    const held = navigator.locks.request(STORAGE_LOCK, { mode: 'exclusive' }, async () => {
        entered.resolve();
        await release.promise;
    });
    await entered.promise;
    return async () => {
        release.resolve();
        await held;
        await withProjectAudioStorageLock(async () => undefined);
    };
}

describe('imported sample placement after real cache eviction', () => {
    const bus = createEventBus<NotificationEvents>();
    let storage: ReturnType<typeof installTransactionalIndexedDb>;
    let notifications: NotifyPayload[];
    let unsubscribe: () => void;
    let releaseWrites: (() => Promise<void>) | undefined;
    let owner = 0;
    let extraProtectedIds: string[] = [];

    beforeAll(() => {
        vi.stubGlobal('AudioBuffer', PcmBuffer);
        vi.stubGlobal('Blob', NodeBlob);
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        storage = installTransactionalIndexedDb();
        unsubscribe = bus.on('ui.notify', (event) => {
            notifications.push(event);
        });
        setNotificationEventBus(bus);
    });

    beforeEach(async () => {
        extraProtectedIds = [];
        batchAdmission.pressure = undefined;
        batchAdmission.actions = [];
        factoryRender.mockReset();
        filesystem.read.mockReset();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('library sample residency');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearActionHistory();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const target = createTrack({ id: 'target', name: 'Target', kind: 'audio', withoutDefaultDevice: true });
        const keeper = createTrack({ id: 'keeper', name: 'Keeper', kind: 'audio', withoutDefaultDevice: true });
        trackStore.set({ tracks: [target, { ...keeper, pan: -0.375 }], selectedTrackId: 'target', ghostClips: [] });
        flushAutomergeStorageWrites();
        await executeAppAction({
            type: 'renameTrack',
            payload: { trackId: 'keeper', name: 'Keeper edited', expectedName: 'Keeper' },
        });
        owner += 1;
        configureCollaborationAssetOwner({ captureOwnerId: () => `library-residency-${owner}` });
        setClipAudioAssetStager(stageAudioBufferAsset);
        configureDurableAudioBufferOwnership(() => Promise.resolve([]));
        configureLiveAudioBufferReferences(() => [
            ...extraProtectedIds,
            ...projectedTracks().flatMap((track) =>
                track.clips.flatMap((clip) => (clip.audioBufferId ? [clip.audioBufferId] : []))
            ),
        ]);
        notifications = [];
    });

    afterEach(async () => {
        await releaseWrites?.();
        releaseWrites = undefined;
        getAssetTransfer()?.dispose();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        configureLiveAudioBufferReferences(null);
        audioBufferCache.clear();
        await withProjectAudioStorageLock(async () => undefined);
        configureDurableAudioBufferOwnership(null);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        unsubscribe();
        await storage.dispose();
        vi.unstubAllGlobals();
    });

    it.each(['stored', 'pending-session'] as const)(
        'places the exact %s original as one real Undo/Redo unit',
        async (source) => {
            const original = originalPcm();
            const transfer = getAssetTransfer();
            if (!transfer) {
                throw new Error('Expected actual asset transfer');
            }
            const assetStaging = vi.spyOn(transfer, 'stageLocalAsset');
            const beforeRaw = structuredClone(rootTracks());
            const beforeProjected = structuredClone(projectedTracks());
            const priorPast = [...history().past];
            expect(priorPast).toHaveLength(1);
            if (source === 'pending-session') {
                releaseWrites = await holdStorageWrites();
            }
            cacheAudioBuffer({ bufferId: BUFFER_ID, buffer: original });
            if (source === 'stored') {
                await withProjectAudioStorageLock(async () => undefined);
            }
            evictUnprotected();
            expect(audioBufferCache.has(BUFFER_ID)).toBe(false);
            const storedBefore = await readStoredOriginal();
            if (source === 'stored') {
                expect(storedBefore).toBeDefined();
            } else {
                expect(storedBefore).toBeUndefined();
            }

            await placeLibrarySample({
                sample: { id: `user-${BUFFER_ID}`, name: NAME, audioBufferId: BUFFER_ID },
                placement: { trackId: 'target', startBeat: 8 },
                authority: { isCurrent: () => true },
                origin: 'timeline-drop',
                readTempo: () => 120,
            });
            flushAutomergeStorageWrites();

            const placed = projectedTracks()[0]!.clips;
            expect(placed).toHaveLength(1);
            const stagedBlob = assetStaging.mock.calls[0]?.[0];
            if (!stagedBlob) {
                throw new Error('Expected actual encoded staging bytes');
            }
            const stagedBytes = await stagedBlob.arrayBuffer();
            expectStagedOriginal(stagedBytes, original);
            const expectedHash = `sha256:${createHash('sha256').update(new Uint8Array(stagedBytes)).digest('hex')}`;
            expect(placed[0]).toMatchObject({
                trackId: 'target',
                type: 'audio',
                name: NAME,
                startBeat: 8,
                endBeat: 9,
                audioBufferId: BUFFER_ID,
                assetHash: expectedHash,
            });
            expect(rootTracks()).toEqual(projectedTracks());
            expect(rootTracks()[1]).toStrictEqual(beforeRaw[1]);
            expectOriginalPcm(original);
            expect(await readStoredOriginal()).toStrictEqual(storedBefore);
            expect(history().past).toHaveLength(2);
            expect(history().past[0]).toStrictEqual(priorPast[0]);
            expect(history().past[1]?.groupLabel).toBe(`Drop sample: ${NAME}`);
            expect(history().future).toEqual([]);
            const forwardRaw = structuredClone(rootTracks());
            const forwardProjected = structuredClone(projectedTracks());
            const forwardHistoryIds = history().past.map((entry) => entry.id);
            await releaseWrites?.();
            releaseWrites = undefined;

            expect(await undo({ stepOverConflicts: false })).toMatchObject({ headConsumed: true });
            flushAutomergeStorageWrites();
            expect(rootTracks()).toStrictEqual(beforeRaw);
            expect(projectedTracks()).toStrictEqual(beforeProjected);
            expect(history().past).toStrictEqual(priorPast);
            expect(history().future).toHaveLength(1);
            await redo({ stepOverConflicts: false });
            flushAutomergeStorageWrites();
            expect(rootTracks()).toStrictEqual(forwardRaw);
            expect(projectedTracks()).toStrictEqual(forwardProjected);
            expect(history().past.map((entry) => entry.id)).toStrictEqual(forwardHistoryIds);
            expect(history().past[0]).toStrictEqual(priorPast[0]);
            expect(history().future).toEqual([]);
            expectOriginalPcm(original);
            expect(notifications).toEqual([]);

            await undo({ stepOverConflicts: false });
            evictUnprotected();
            expect(audioBufferCache.has(BUFFER_ID)).toBe(false);
        }
    );

    it('protects a newly decoded library file before staging and releases its hold after Undo', async () => {
        extraProtectedIds = Array.from({ length: CAPACITY }, (_, index) => `live-${index}`);
        for (const id of extraProtectedIds) {
            cacheAudioBuffer({ bufferId: id, buffer: new PcmBuffer({ length: 1, sampleRate: 48_000 }) });
        }
        const original = originalPcm();
        const bytes = await audioBufferToWav(original);
        const file = new NodeFile([bytes], 'Library.wav', { type: 'audio/wav' });
        filesystem.read.mockResolvedValue({ status: 'resolved', file });
        const context = getAudioContext();
        const previousDecode = context.decodeAudioData;
        const decoder = vi.fn<(input: ArrayBuffer) => Promise<AudioBuffer>>().mockResolvedValue(original);
        context.decodeAudioData = decoder;
        const cacheWrites = vi.spyOn(audioBufferCache, 'set');
        const transfer = getAssetTransfer();
        if (!transfer) {
            throw new Error('Expected real asset transfer');
        }
        const realStage = transfer.stageLocalAsset.bind(transfer);
        const entered = deferred<void>();
        const continueStaging = deferred<void>();
        const staging = vi.spyOn(transfer, 'stageLocalAsset').mockImplementation(async (blob, name) => {
            entered.resolve();
            await continueStaging.promise;
            return realStage(blob, name);
        });
        const placement = placeLibrarySample({
            sample: { id: 'library-file-entry', name: NAME, path: 'Library.wav', libraryRootId: 'browser-folder' },
            placement: { trackId: 'target', startBeat: 8 },
            authority: { isCurrent: () => true },
            origin: 'timeline-drop',
            readTempo: () => 120,
        });
        let decodedId: string | undefined;
        try {
            await Promise.race([
                entered.promise,
                placement.then(() => {
                    throw new Error('Library file placement ended before staging');
                }),
            ]);
            decodedId = cacheWrites.mock.calls.find((call) => call[1] === original)?.[0];
            if (!decodedId) {
                throw new Error('Expected actual decoded cache identity');
            }
            expect(decodedId).toMatch(/^audio-/);
            expect(audioBufferCache.has(decodedId)).toBe(true);
            cacheAudioBuffer({
                bufferId: 'competing-during-file-staging',
                buffer: new PcmBuffer({ length: 1, sampleRate: 48_000 }),
            });
            expect(audioBufferCache.has(decodedId)).toBe(true);
        } finally {
            continueStaging.resolve();
            await placement;
            context.decodeAudioData = previousDecode;
            staging.mockRestore();
            cacheWrites.mockRestore();
        }
        if (!decodedId) {
            throw new Error('Expected decoded identity after placement');
        }
        expect(decoder).toHaveBeenCalledTimes(1);
        expect(new Uint8Array(decoder.mock.calls[0]![0])).toStrictEqual(new Uint8Array(bytes));
        expectOriginalPcm(original, decodedId);
        expect(projectedTracks()[0]!.clips[0]?.audioBufferId).toBe(decodedId);
        expect(rootTracks()).toEqual(projectedTracks());
        await undo({ stepOverConflicts: false });
        cacheAudioBuffer({
            bufferId: 'after-library-file-undo',
            buffer: new PcmBuffer({ length: 1, sampleRate: 48_000 }),
        });
        expect(audioBufferCache.has(decodedId)).toBe(false);
        expect(notifications).toEqual([]);
    });

    it('refuses staging when authority is revoked during candidate restoration', async () => {
        cacheAudioBuffer({ bufferId: BUFFER_ID, buffer: originalPcm() });
        const beforeRaw = structuredClone(rootTracks());
        const beforeProjected = structuredClone(projectedTracks());
        const beforeHistory = history();
        let stageCalls = 0;
        setClipAudioAssetStager(async (buffer, name) => {
            stageCalls += 1;
            return stageAudioBufferAsset(buffer, name);
        });
        let current = true;
        const placement = placeLibrarySample({
            sample: { id: `user-${BUFFER_ID}`, name: NAME, audioBufferId: BUFFER_ID },
            placement: { trackId: 'target', startBeat: 8 },
            authority: { isCurrent: () => current },
            origin: 'timeline-drop',
            readTempo: () => 120,
        });
        current = false;
        owner += 1;
        await placement;
        expect(stageCalls).toBe(0);
        expect(rootTracks()).toStrictEqual(beforeRaw);
        expect(projectedTracks()).toStrictEqual(beforeProjected);
        expect(history()).toStrictEqual(beforeHistory);
        evictUnprotected();
        expect(audioBufferCache.has(BUFFER_ID)).toBe(false);
        expect(notifications).toEqual([]);
    });

    it('holds the restored original through staging and commit admission, then releases it', async () => {
        const original = originalPcm();
        cacheAudioBuffer({ bufferId: BUFFER_ID, buffer: original });
        await withProjectAudioStorageLock(async () => undefined);
        evictUnprotected();
        expect(audioBufferCache.has(BUFFER_ID)).toBe(false);
        const entered = deferred<void>();
        const continueStaging = deferred<void>();
        let checkedCommitAdmission = false;
        setClipAudioAssetStager(async (buffer, name) => {
            entered.resolve();
            await continueStaging.promise;
            return stageAudioBufferAsset(buffer, name);
        });
        batchAdmission.pressure = () => {
            if (checkedCommitAdmission) {
                return;
            }
            checkedCommitAdmission = true;
            expect(rootTracks()[0]!.clips).toEqual([]);
            evictUnprotected();
            expect(audioBufferCache.has(BUFFER_ID)).toBe(true);
        };
        const placement = placeLibrarySample({
            sample: { id: `user-${BUFFER_ID}`, name: NAME, audioBufferId: BUFFER_ID },
            placement: { trackId: 'target', startBeat: 8 },
            authority: { isCurrent: () => true },
            origin: 'browser-add',
            readTempo: () => 120,
        });
        try {
            await Promise.race([
                entered.promise,
                placement.then(() => {
                    throw new Error('Placement ended before real asset staging');
                }),
            ]);
            evictUnprotected();
            expectOriginalPcm(original);
            expect(rootTracks()[0]!.clips).toEqual([]);
        } finally {
            continueStaging.resolve();
            try {
                await placement;
            } finally {
                batchAdmission.pressure = undefined;
            }
        }
        expect(checkedCommitAdmission).toBe(true);
        expect(rootTracks()).toEqual(projectedTracks());
        expect(projectedTracks()[0]!.clips).toHaveLength(1);
        expectOriginalPcm(original);
        await undo({ stepOverConflicts: false });
        evictUnprotected();
        expect(audioBufferCache.has(BUFFER_ID)).toBe(false);
        expect(notifications).toEqual([]);
    });

    it('does not publish a cold storage read after its placement authority is revoked', async () => {
        const original = originalPcm();
        cacheAudioBuffer({ bufferId: BUFFER_ID, buffer: original });
        await withProjectAudioStorageLock(async () => undefined);
        await clearRuntimeCachedAudioBuffers();
        expect(audioBufferCache.has(BUFFER_ID)).toBe(false);
        const beforeRaw = structuredClone(rootTracks());
        const beforeProjected = structuredClone(projectedTracks());
        const beforeHistory = history();
        let stageCalls = 0;
        setClipAudioAssetStager(async (buffer, name) => {
            stageCalls += 1;
            return stageAudioBufferAsset(buffer, name);
        });
        const readStarted = deferred<void>();
        const finishRead = deferred<void>();
        const { IDBObjectStore: FakeIDBObjectStore } = await import('fake-indexeddb');
        const nativeGet = FakeIDBObjectStore.prototype.get;
        vi.spyOn(FakeIDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, ...args) {
            const request = nativeGet.apply(this, args);
            if (this.name !== 'buffers' || this.transaction.mode !== 'readonly' || args[0] !== BUFFER_ID) {
                return request;
            }
            let success: ((this: IDBRequest, event: Event) => unknown) | null = null;
            Object.defineProperty(request, 'onsuccess', {
                configurable: true,
                get: () => (event: Event) => {
                    readStarted.resolve();
                    void finishRead.promise.then(() => success?.call(request, event));
                },
                set: (callback) => {
                    success = callback;
                },
            });
            return request;
        });
        let current = true;
        const placement = placeLibrarySample({
            sample: { id: `user-${BUFFER_ID}`, name: NAME, audioBufferId: BUFFER_ID },
            placement: { trackId: 'target', startBeat: 8 },
            authority: { isCurrent: () => current },
            origin: 'timeline-drop',
            readTempo: () => 120,
        });
        try {
            await Promise.race([
                readStarted.promise,
                placement.then(() => {
                    throw new Error('Placement ended before its stored PCM read completed');
                }),
            ]);
            current = false;
            owner += 1;
            await clearRuntimeCachedAudioBuffers();
        } finally {
            finishRead.resolve();
            await placement;
        }
        const cached = getCachedAudioBuffer({ bufferId: BUFFER_ID });
        let durabilitySourceRevision: number | undefined;
        if (cached) {
            durabilitySourceRevision = audioBufferCache.readRuntimeMaterialPublication(BUFFER_ID, cached);
        }

        expect({
            cacheResident: cached !== null,
            durabilitySourceRevision,
            stageCalls,
        }).toEqual({ cacheResident: false, durabilitySourceRevision: undefined, stageCalls: 0 });
        expect(rootTracks()).toStrictEqual(beforeRaw);
        expect(projectedTracks()).toStrictEqual(beforeProjected);
        expect(history()).toStrictEqual(beforeHistory);
        expect(notifications).toEqual([]);
    });

    it.each(['staging-failure', 'stale-authority'] as const)(
        'releases restored PCM without project effects after %s',
        async (outcome) => {
            const original = originalPcm();
            cacheAudioBuffer({ bufferId: BUFFER_ID, buffer: original });
            await withProjectAudioStorageLock(async () => undefined);
            evictUnprotected();
            expect(audioBufferCache.has(BUFFER_ID)).toBe(false);
            const beforeRaw = structuredClone(rootTracks());
            const beforeProjected = structuredClone(projectedTracks());
            const beforeHistory = history();
            const entered = deferred<void>();
            const continueStaging = deferred<void>();
            let current = true;
            let staged: Awaited<ReturnType<typeof stageAudioBufferAsset>> | undefined;
            setClipAudioAssetStager(async (buffer, name) => {
                entered.resolve();
                await continueStaging.promise;
                if (outcome === 'staging-failure') {
                    throw new Error('External asset storage refused staging');
                }
                staged = await stageAudioBufferAsset(buffer, name);
                return staged;
            });
            const placement = placeLibrarySample({
                sample: { id: `user-${BUFFER_ID}`, name: NAME, audioBufferId: BUFFER_ID },
                placement: { trackId: 'target', startBeat: 8 },
                authority: { isCurrent: () => current },
                origin: 'timeline-drop',
                readTempo: () => 120,
            });
            try {
                await Promise.race([
                    entered.promise,
                    placement.then(() => {
                        throw new Error('Placement ended before real asset staging');
                    }),
                ]);
                evictUnprotected();
                expectOriginalPcm(original);
                if (outcome === 'stale-authority') {
                    current = false;
                }
            } finally {
                continueStaging.resolve();
                await placement;
            }
            expect(rootTracks()).toStrictEqual(beforeRaw);
            expect(projectedTracks()).toStrictEqual(beforeProjected);
            expect(history()).toStrictEqual(beforeHistory);
            if (outcome === 'staging-failure') {
                expect(notifications).toMatchObject([
                    { message: `Failed to import "${NAME}" — asset registration failed`, level: 'error' },
                ]);
            } else {
                expect(notifications).toEqual([]);
                if (!staged) {
                    throw new Error('Expected actual staged asset before authority became stale');
                }
                expect(getAssetTransfer()?.promoteStagedAsset(staged.leaseId)).toBe(false);
            }
            evictUnprotected();
            expect(audioBufferCache.has(BUFFER_ID)).toBe(false);
        }
    );

    it('refuses placement when a same-ID cache write replaces the PCM captured for staging', async () => {
        const original = originalPcm();
        cacheAudioBuffer({ bufferId: BUFFER_ID, buffer: original });
        await withProjectAudioStorageLock(async () => undefined);
        evictUnprotected();
        expect(audioBufferCache.has(BUFFER_ID)).toBe(false);
        const beforeRaw = structuredClone(rootTracks());
        const beforeProjected = structuredClone(projectedTracks());
        const beforeHistory = history();
        const entered = deferred<void>();
        const continueStaging = deferred<void>();
        let staged: Awaited<ReturnType<typeof stageAudioBufferAsset>> | undefined;
        setClipAudioAssetStager(async (buffer, name) => {
            for (let channel = 0; channel < original.numberOfChannels; channel += 1) {
                expect(buffer.getChannelData(channel)).toStrictEqual(original.getChannelData(channel));
            }
            entered.resolve();
            await continueStaging.promise;
            staged = await stageAudioBufferAsset(buffer, name);
            return staged;
        });
        const replacement = originalPcm();
        replacement.copyToChannel(new Float32Array([0.75, -0.25, 0.875, 0.5, -0.5, 0.125, -0.9375]), 0);
        replacement.copyToChannel(new Float32Array([-0.125, 0.625, -0.75, 0.25, 0.5, -0.375, 0.8125]), 1);
        const placement = placeLibrarySample({
            sample: { id: `user-${BUFFER_ID}`, name: NAME, audioBufferId: BUFFER_ID },
            placement: { trackId: 'target', startBeat: 8 },
            authority: { isCurrent: () => true },
            origin: 'timeline-drop',
            readTempo: () => 120,
        });
        try {
            await Promise.race([
                entered.promise,
                placement.then(() => {
                    throw new Error('Placement ended before real asset staging');
                }),
            ]);
            cacheAudioBuffer({ bufferId: BUFFER_ID, buffer: replacement });
            expect(getCachedAudioBuffer({ bufferId: BUFFER_ID })).toBe(replacement);
        } finally {
            continueStaging.resolve();
            await placement;
        }

        expect(rootTracks()).toStrictEqual(beforeRaw);
        expect(projectedTracks()).toStrictEqual(beforeProjected);
        expect(history()).toStrictEqual(beforeHistory);
        expect(getCachedAudioBuffer({ bufferId: BUFFER_ID })).toBe(replacement);
        expect(notifications).toMatchObject([{ level: 'error' }]);
        if (!staged) {
            throw new Error('Expected the original PCM to finish staging');
        }
        expect(getAssetTransfer()?.promoteStagedAsset(staged.leaseId)).toBe(false);
        evictUnprotected();
        expect(audioBufferCache.has(BUFFER_ID)).toBe(false);
    });

    it('refuses a concurrent same-ID cache fill while the cold stored read is pending', async () => {
        const original = originalPcm();
        cacheAudioBuffer({ bufferId: BUFFER_ID, buffer: original });
        await withProjectAudioStorageLock(async () => undefined);
        evictUnprotected();
        expect(audioBufferCache.has(BUFFER_ID)).toBe(false);
        const beforeRaw = structuredClone(rootTracks());
        const beforeProjected = structuredClone(projectedTracks());
        const beforeHistory = history();
        let stageCalls = 0;
        setClipAudioAssetStager(async (buffer, name) => {
            stageCalls += 1;
            return stageAudioBufferAsset(buffer, name);
        });
        const readStarted = deferred<void>();
        const finishRead = deferred<void>();
        const { IDBObjectStore: FakeIDBObjectStore } = await import('fake-indexeddb');
        const nativeGet = FakeIDBObjectStore.prototype.get;
        vi.spyOn(FakeIDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, ...args) {
            const request = nativeGet.apply(this, args);
            if (this.name !== 'buffers' || this.transaction.mode !== 'readonly' || args[0] !== BUFFER_ID) {
                return request;
            }
            let success: ((this: IDBRequest, event: Event) => unknown) | null = null;
            Object.defineProperty(request, 'onsuccess', {
                configurable: true,
                get: () => (event: Event) => {
                    readStarted.resolve();
                    void finishRead.promise.then(() => success?.call(request, event));
                },
                set: (callback) => {
                    success = callback;
                },
            });
            return request;
        });
        const replacement = originalPcm();
        const placement = placeLibrarySample({
            sample: { id: `user-${BUFFER_ID}`, name: NAME, audioBufferId: BUFFER_ID },
            placement: { trackId: 'target', startBeat: 8 },
            authority: { isCurrent: () => true },
            origin: 'timeline-drop',
            readTempo: () => 120,
        });
        try {
            await Promise.race([
                readStarted.promise,
                placement.then(() => {
                    throw new Error('Placement ended before its stored PCM read completed');
                }),
            ]);
            cacheAudioBuffer({ bufferId: BUFFER_ID, buffer: replacement });
            expect(getCachedAudioBuffer({ bufferId: BUFFER_ID })).toBe(replacement);
        } finally {
            finishRead.resolve();
            await placement;
        }

        expect(stageCalls).toBe(0);
        expect(rootTracks()).toStrictEqual(beforeRaw);
        expect(projectedTracks()).toStrictEqual(beforeProjected);
        expect(history()).toStrictEqual(beforeHistory);
        expect(getCachedAudioBuffer({ bufferId: BUFFER_ID })).toBe(replacement);
        expect(notifications).toMatchObject([{ level: 'error' }]);
    });

    it('preserves replacement decoded PCM when rejection cleans the prepared buffer', async () => {
        const original = originalPcm();
        const bytes = await audioBufferToWav(original);
        const file = new NodeFile([bytes], 'Library.wav', { type: 'audio/wav' });
        filesystem.read.mockResolvedValue({ status: 'resolved', file });
        const context = getAudioContext();
        const previousDecode = context.decodeAudioData;
        context.decodeAudioData = vi.fn<(input: ArrayBuffer) => Promise<AudioBuffer>>().mockResolvedValue(original);
        const cacheWrites = vi.spyOn(audioBufferCache, 'set');
        const transfer = getAssetTransfer();
        if (!transfer) {
            throw new Error('Expected real asset transfer');
        }
        const realStage = transfer.stageLocalAsset.bind(transfer);
        const entered = deferred<void>();
        const continueStaging = deferred<void>();
        let staged: Awaited<ReturnType<typeof stageAudioBufferAsset>> | undefined;
        const staging = vi.spyOn(transfer, 'stageLocalAsset').mockImplementation(async (blob, name) => {
            entered.resolve();
            await continueStaging.promise;
            staged = await realStage(blob, name);
            return staged;
        });
        const beforeRaw = structuredClone(rootTracks());
        const beforeProjected = structuredClone(projectedTracks());
        const beforeHistory = history();
        const replacement = originalPcm();
        const placement = placeLibrarySample({
            sample: { id: 'library-file-entry', name: NAME, path: 'Library.wav', libraryRootId: 'browser-folder' },
            placement: { trackId: 'target', startBeat: 8 },
            authority: { isCurrent: () => true },
            origin: 'timeline-drop',
            readTempo: () => 120,
        });
        let decodedId: string | undefined;
        try {
            await Promise.race([
                entered.promise,
                placement.then(() => {
                    throw new Error('Placement ended before decoded PCM staging');
                }),
            ]);
            decodedId = cacheWrites.mock.calls.find((call) => call[1] === original)?.[0];
            if (!decodedId) {
                throw new Error('Expected actual decoded cache identity');
            }
            cacheAudioBuffer({ bufferId: decodedId, buffer: replacement });
            expect(getCachedAudioBuffer({ bufferId: decodedId })).toBe(replacement);
        } finally {
            continueStaging.resolve();
            await placement;
            context.decodeAudioData = previousDecode;
            staging.mockRestore();
            cacheWrites.mockRestore();
        }

        if (!decodedId) {
            throw new Error('Expected decoded identity after placement');
        }
        if (!staged) {
            throw new Error('Expected the original decoded PCM to finish staging');
        }
        expect(rootTracks()).toStrictEqual(beforeRaw);
        expect(projectedTracks()).toStrictEqual(beforeProjected);
        expect(history()).toStrictEqual(beforeHistory);
        expect(getCachedAudioBuffer({ bufferId: decodedId })).toBe(replacement);
        expect(getAssetTransfer()?.promoteStagedAsset(staged.leaseId)).toBe(false);
        expect(notifications).toMatchObject([{ level: 'error' }]);
    });

    it('refuses a concurrent same-ID cache fill while cold factory rendering is pending', async () => {
        const factoryId = 'factory-cold-race';
        const previousLibrary = libraryStore.value;
        if (!previousLibrary) {
            throw new Error('Expected sample library state');
        }
        const rendered = originalPcm();
        const replacement = originalPcm();
        replacement.copyToChannel(new Float32Array([0.75, -0.25, 0.875, 0.5, -0.5, 0.125, -0.9375]), 0);
        replacement.copyToChannel(new Float32Array([-0.125, 0.625, -0.75, 0.25, 0.5, -0.375, 0.8125]), 1);
        const renderStarted = deferred<void>();
        const continueRender = deferred<void>();
        factoryRender.mockImplementation(async () => {
            renderStarted.resolve();
            await continueRender.promise;
            return [{ id: factoryId, name: NAME, category: 'drums', tags: ['factory'], buffer: rendered }];
        });
        libraryStore.set({
            ...previousLibrary,
            roots: [
                {
                    id: 'factory',
                    name: 'Factory',
                    provider: 'browser',
                    rootRef: '',
                    connectedAt: 0,
                    status: 'ready',
                    fileCount: 1,
                    settings: { recursive: true },
                },
            ],
            samples: [
                {
                    id: factoryId,
                    libraryRootId: 'factory',
                    relativePath: `${NAME}.factory`,
                    displayName: NAME,
                    ext: 'factory',
                    folder: '',
                    sync: { exists: true, status: 'analyzed' },
                    format: {
                        durationSec: rendered.duration,
                        sampleRate: rendered.sampleRate,
                        channels: rendered.numberOfChannels,
                        bitDepth: 32,
                    },
                    tags: ['factory'],
                    favorite: false,
                },
            ],
        });
        const beforeRaw = structuredClone(rootTracks());
        const beforeProjected = structuredClone(projectedTracks());
        const beforeHistory = history();
        let stageCalls = 0;
        const stagedBuffers: AudioBuffer[] = [];
        setClipAudioAssetStager(async (buffer, name) => {
            stageCalls += 1;
            stagedBuffers.push(buffer);
            return stageAudioBufferAsset(buffer, name);
        });
        const placement = placeLibrarySample({
            sample: { id: factoryId, name: NAME },
            placement: { trackId: 'target', startBeat: 8 },
            authority: { isCurrent: () => true },
            origin: 'timeline-drop',
            readTempo: () => 120,
        });
        try {
            await Promise.race([
                renderStarted.promise,
                placement.then(() => {
                    throw new Error('Placement ended before factory rendering');
                }),
            ]);
            cacheAudioBuffer({ bufferId: factoryId, buffer: replacement });
            expect(getCachedAudioBuffer({ bufferId: factoryId })).toBe(replacement);
        } finally {
            continueRender.resolve();
            await placement;
            libraryStore.set(previousLibrary);
        }

        expect(batchAdmission.actions).toEqual([]);
        expect(stageCalls).toBe(0);
        expect(stagedBuffers).toEqual([]);
        expect(rootTracks()).toStrictEqual(beforeRaw);
        expect(projectedTracks()).toStrictEqual(beforeProjected);
        expect(history()).toStrictEqual(beforeHistory);
        expect(getCachedAudioBuffer({ bufferId: factoryId })).toBe(replacement);
        expect(notifications).toMatchObject([
            { message: `Could not place "${NAME}" — its audio changed before placement.`, level: 'error' },
        ]);
    });

    it('places freshly rendered PCM when cold factory resolution has no cache race', async () => {
        const factoryId = 'factory-cold-render';
        const previousLibrary = libraryStore.value;
        if (!previousLibrary) {
            throw new Error('Expected sample library state');
        }
        const rendered = originalPcm();
        factoryRender.mockResolvedValue([
            { id: factoryId, name: NAME, category: 'drums', tags: ['factory'], buffer: rendered },
        ]);
        libraryStore.set({
            ...previousLibrary,
            roots: [
                {
                    id: 'factory',
                    name: 'Factory',
                    provider: 'browser',
                    rootRef: '',
                    connectedAt: 0,
                    status: 'ready',
                    fileCount: 1,
                    settings: { recursive: true },
                },
            ],
            samples: [
                {
                    id: factoryId,
                    libraryRootId: 'factory',
                    relativePath: `${NAME}.factory`,
                    displayName: NAME,
                    ext: 'factory',
                    folder: '',
                    sync: { exists: true, status: 'analyzed' },
                    format: {
                        durationSec: rendered.duration,
                        sampleRate: rendered.sampleRate,
                        channels: rendered.numberOfChannels,
                        bitDepth: 32,
                    },
                    tags: ['factory'],
                    favorite: false,
                },
            ],
        });
        const stagedBuffers: AudioBuffer[] = [];
        let staged: Awaited<ReturnType<typeof stageAudioBufferAsset>> | undefined;
        setClipAudioAssetStager(async (buffer, name) => {
            stagedBuffers.push(buffer);
            staged = await stageAudioBufferAsset(buffer, name);
            return staged;
        });
        const priorPast = [...history().past];
        try {
            await placeLibrarySample({
                sample: { id: factoryId, name: NAME },
                placement: { trackId: 'target', startBeat: 8 },
                authority: { isCurrent: () => true },
                origin: 'timeline-drop',
                readTempo: () => 120,
            });
        } finally {
            libraryStore.set(previousLibrary);
        }

        expect(factoryRender).toHaveBeenCalledTimes(1);
        expect(batchAdmission.actions).toHaveLength(1);
        expect(stagedBuffers).toHaveLength(1);
        expect(stagedBuffers[0]).toBe(rendered);
        if (!staged) {
            throw new Error('Expected freshly rendered PCM to be staged');
        }
        const placed = projectedTracks()[0]!.clips;
        expect(placed).toHaveLength(1);
        expect(placed[0]).toMatchObject({
            trackId: 'target',
            type: 'audio',
            name: NAME,
            startBeat: 8,
            endBeat: 9,
            audioBufferId: factoryId,
            assetHash: staged.hash,
        });
        expect(rootTracks()).toEqual(projectedTracks());
        expect(history().past).toHaveLength(priorPast.length + 1);
        expect(history().past.slice(0, -1)).toStrictEqual(priorPast);
        expect(history().future).toEqual([]);
        expect(getCachedAudioBuffer({ bufferId: factoryId })).toBe(rendered);
        expect(notifications).toEqual([]);
    });
});
