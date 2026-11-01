import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    cacheAudioBuffer,
    configureDurableAudioBufferOwnership,
    configureHistoryAudioBufferReferences,
    configureLiveAudioBufferReferences,
    garbageCollectCachedAudioBuffersByAge,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
    undoReplayPreparationPort,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { initAudioBufferCacheAccess } from '../initAudioBufferCacheAccess';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

/** The runtime cache's LRU cap; one more unrelated write than this evicts anything unprotected. */
const CACHE_CAPACITY = 64;
const TRACK_ID = 'track-1';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

/** Rehydration builds its buffer with the `AudioBuffer` constructor, as Chromium does. */
class TestAudioBuffer {
    readonly duration: number;
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    private readonly channels: Float32Array<ArrayBuffer>[];

    constructor({ length, numberOfChannels = 1, sampleRate }: AudioBufferOptions) {
        this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
        this.duration = length / sampleRate;
        this.length = length;
        this.numberOfChannels = numberOfChannels;
        this.sampleRate = sampleRate;
    }

    copyFromChannel(destination: Float32Array<ArrayBuffer>, channelNumber: number): void {
        destination.set(this.channels[channelNumber]!.subarray(0, destination.length));
    }

    copyToChannel(source: Float32Array<ArrayBuffer>, channelNumber: number): void {
        this.channels[channelNumber]!.set(source);
    }

    getChannelData(channelNumber: number): Float32Array<ArrayBuffer> {
        return this.channels[channelNumber]!;
    }
}

function createAudioBuffer(sample = 0): AudioBuffer {
    const buffer = new TestAudioBuffer({ length: 1, numberOfChannels: 1, sampleRate: 48_000 });
    buffer.getChannelData(0)[0] = sample;
    return buffer;
}

/** Imports, bounces and factory browsing: unrelated buffers nothing references. */
function fillCacheWithUnrelatedBuffers(prefix: string): void {
    for (let index = 0; index <= CACHE_CAPACITY; index++) {
        cacheAudioBuffer({ buffer: createAudioBuffer(), bufferId: `${prefix}-${index}` });
    }
}

function liveBufferIds(): (string | undefined)[] {
    return trackStore.value?.tracks.flatMap((track) => track.clips.map((clip) => clip.audioBufferId)) ?? [];
}

function residentSample(bufferId: string): number | undefined {
    return audioBufferCache.get(bufferId)?.getChannelData(0)[0];
}

async function addRecordedClip(bufferId: string, sample = 0.5, clipId = 'take-clip'): Promise<void> {
    cacheAudioBuffer({ buffer: createAudioBuffer(sample), bufferId });
    await executeAppAction(
        {
            type: 'addClip',
            payload: {
                id: clipId,
                trackId: TRACK_ID,
                startBeat: 0,
                endBeat: 4,
                name: 'Take',
                type: 'audio',
                audioBufferId: bufferId,
            },
        },
        { source: 'manual' }
    );
}

function removeClip(clipId = 'take-clip'): Promise<unknown> {
    return executeAppAction({ type: 'removeClip', payload: { clipId } }, { source: 'manual' });
}

/** Every cache write queues a persistence attempt behind the storage lock;
 * this resolves once all of them have run. */
function settleAudioPersistence(): Promise<void> {
    return withProjectAudioStorageLock(() => Promise.resolve());
}

/** Holds the storage lock so every cache write made meanwhile stays not yet durable. */
function holdAudioPersistence(): { release: () => Promise<void> } {
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
        open = resolve;
    });
    const held = withProjectAudioStorageLock(() => gate);
    return {
        release: async () => {
            open();
            await held;
        },
    };
}

describe('undo history audio buffer residency (#6003)', () => {
    let installation: TransactionalIndexedDbInstallation;

    // One database for the file: the cache keeps its connection for the life
    // of the module, and deleting the database between cases would leave it
    // surrendered to that versionchange for every later case.
    beforeAll(() => {
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        vi.stubGlobal('AudioBuffer', TestAudioBuffer);
        installation = installTransactionalIndexedDb();
    });

    afterAll(async () => {
        await settleAudioPersistence();
        await installation.dispose();
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('undo history audio buffer residency');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [createTrack({ id: TRACK_ID, name: 'Audio', kind: 'audio', withoutDefaultDevice: true })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        initAudioBufferCacheAccess();
    });

    afterEach(async () => {
        configureLiveAudioBufferReferences(null);
        configureHistoryAudioBufferReferences(null);
        undoReplayPreparationPort.setProvider(null);
        // No saved project owns this file's PCM, so the store clear may delete it.
        configureDurableAudioBufferOwnership(() => Promise.resolve([]));
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        await settleAudioPersistence();
        audioBufferCache.clear();
        await settleAudioPersistence();
        configureDurableAudioBufferOwnership(null);
    });

    it('lets a stored deleted take go and rehydrates it before undo restores the clip', async () => {
        await addRecordedClip('rec-take', 0.25);
        await removeClip();
        await settleAudioPersistence();

        fillCacheWithUnrelatedBuffers('import');
        expect(audioBufferCache.has('rec-take')).toBe(false);

        await undo();
        expect(liveBufferIds()).toEqual(['rec-take']);
        expect(residentSample('rec-take')).toBe(0.25);
    });

    it('lets a stored undone take go and rehydrates it before redo restores the clip', async () => {
        await addRecordedClip('rec-redo', 0.75);
        await undo();
        await settleAudioPersistence();

        fillCacheWithUnrelatedBuffers('bounce');
        expect(audioBufferCache.has('rec-redo')).toBe(false);

        await redo();
        expect(liveBufferIds()).toEqual(['rec-redo']);
        expect(residentSample('rec-redo')).toBe(0.75);
    });

    it('keeps the stored record of a take only the history names through an age collection', async () => {
        await addRecordedClip('rec-collected', 0.5);
        await removeClip();
        await settleAudioPersistence();
        fillCacheWithUnrelatedBuffers('import');
        expect(audioBufferCache.has('rec-collected')).toBe(false);

        // The collector runs only against a loaded project's ownership census; a
        // negative age makes every unowned record old enough to delete.
        projectStore.set({ ...defaultProjectStoreState, loading: false });
        try {
            await expect(garbageCollectCachedAudioBuffersByAge({ maxAgeDays: -1 })).resolves.toBeGreaterThan(0);
        } finally {
            projectStore.set(defaultProjectStoreState);
        }

        await undo();
        expect(residentSample('rec-collected')).toBe(0.5);
    });

    it('bounds the buffers only the history names once they are stored', async () => {
        const takeCount = CACHE_CAPACITY + 8;
        for (let index = 0; index < takeCount; index++) {
            await addRecordedClip(`rec-cycle-${index}`, 0.5, `take-${index}`);
            await removeClip(`take-${index}`);
        }
        await settleAudioPersistence();
        cacheAudioBuffer({ buffer: createAudioBuffer(), bufferId: 'next-import' });

        const resident = Array.from({ length: takeCount }, (_, index) => `rec-cycle-${index}`).filter((id) =>
            audioBufferCache.has(id)
        );
        expect(resident.length).toBeLessThan(CACHE_CAPACITY);
    });

    it('keeps a deleted take resident while its audio is not yet stored', async () => {
        const persistence = holdAudioPersistence();
        try {
            await addRecordedClip('rec-unstored');
            await removeClip();
            fillCacheWithUnrelatedBuffers('import');
            expect(audioBufferCache.has('import-0')).toBe(false);
            expect(audioBufferCache.has('rec-unstored')).toBe(true);
        } finally {
            await persistence.release();
        }
    });

    it('lets an unstored buffer go once the history that held it is cleared', async () => {
        const persistence = holdAudioPersistence();
        try {
            await addRecordedClip('rec-cleared');
            await removeClip();
            fillCacheWithUnrelatedBuffers('import');
            expect(audioBufferCache.has('rec-cleared')).toBe(true);

            // A project change clears the history: nothing can restore the clip.
            clearUndoHistory();
            fillCacheWithUnrelatedBuffers('library');
            expect(audioBufferCache.has('rec-cleared')).toBe(false);
        } finally {
            await persistence.release();
        }
    });

    it('lets an unstored buffer go once a new edit discards the redo that held it', async () => {
        const persistence = holdAudioPersistence();
        try {
            await addRecordedClip('rec-discarded');
            await undo();
            fillCacheWithUnrelatedBuffers('import');
            expect(audioBufferCache.has('rec-discarded')).toBe(true);

            await executeAppAction(
                {
                    type: 'addClip',
                    payload: { trackId: TRACK_ID, startBeat: 8, endBeat: 12, name: 'MIDI', type: 'midi' },
                },
                { source: 'manual' }
            );
            fillCacheWithUnrelatedBuffers('library');
            expect(audioBufferCache.has('rec-discarded')).toBe(false);
        } finally {
            await persistence.release();
        }
    });

    it('still evicts a buffer nothing references', () => {
        cacheAudioBuffer({ buffer: createAudioBuffer(), bufferId: 'orphan' });
        fillCacheWithUnrelatedBuffers('library');
        expect(audioBufferCache.has('orphan')).toBe(false);
    });
});
