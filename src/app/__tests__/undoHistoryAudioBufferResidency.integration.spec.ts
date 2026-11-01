import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
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
    configureLiveAudioBufferReferences,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

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

function createAudioBuffer(): AudioBuffer {
    const channel = new Float32Array(1);
    return {
        copyFromChannel: (destination) => destination.set(channel.subarray(0, destination.length)),
        copyToChannel: (source) => channel.set(source),
        duration: 1 / 48_000,
        getChannelData: () => channel,
        length: 1,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
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

async function addRecordedClip(bufferId: string): Promise<void> {
    cacheAudioBuffer({ buffer: createAudioBuffer(), bufferId });
    await executeAppAction(
        {
            type: 'addClip',
            payload: {
                id: 'take-clip',
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

/** Every cache write queues a persistence attempt behind the storage lock;
 * this resolves once all of them have run. */
function settleAudioPersistence(): Promise<void> {
    return withProjectAudioStorageLock(() => Promise.resolve());
}

describe('undo history audio buffer residency (#6003)', () => {
    let installation: TransactionalIndexedDbInstallation;

    // One database for the file: the cache keeps its connection for the life
    // of the module, and deleting the database between cases would leave it
    // surrendered to that versionchange for every later case.
    beforeAll(() => {
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
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

    it('keeps a deleted clip’s buffer resident so undo restores an audible clip', async () => {
        await addRecordedClip('rec-take');
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'take-clip' } }, { source: 'manual' });
        expect(liveBufferIds()).toEqual([]);

        fillCacheWithUnrelatedBuffers('import');
        expect(audioBufferCache.has('import-0')).toBe(false);
        expect(audioBufferCache.has('rec-take')).toBe(true);

        await undo();
        expect(liveBufferIds()).toEqual(['rec-take']);
        expect(audioBufferCache.has('rec-take')).toBe(true);
    });

    it('keeps an undone clip’s buffer resident so redo restores an audible clip', async () => {
        await addRecordedClip('rec-redo');
        await undo();
        expect(liveBufferIds()).toEqual([]);

        fillCacheWithUnrelatedBuffers('bounce');
        expect(audioBufferCache.has('rec-redo')).toBe(true);

        await redo();
        expect(liveBufferIds()).toEqual(['rec-redo']);
        expect(audioBufferCache.has('rec-redo')).toBe(true);
    });

    it('lets the buffer go once the history that held it is cleared', async () => {
        await addRecordedClip('rec-cleared');
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'take-clip' } }, { source: 'manual' });
        fillCacheWithUnrelatedBuffers('import');
        expect(audioBufferCache.has('rec-cleared')).toBe(true);

        // A project change clears the history: nothing can restore the clip.
        clearUndoHistory();
        fillCacheWithUnrelatedBuffers('library');
        expect(audioBufferCache.has('rec-cleared')).toBe(false);
    });

    it('lets the buffer go once a new edit discards the redo that held it', async () => {
        await addRecordedClip('rec-discarded');
        await undo();
        fillCacheWithUnrelatedBuffers('import');
        expect(audioBufferCache.has('rec-discarded')).toBe(true);

        await executeAppAction(
            { type: 'addClip', payload: { trackId: TRACK_ID, startBeat: 8, endBeat: 12, name: 'MIDI', type: 'midi' } },
            { source: 'manual' }
        );
        fillCacheWithUnrelatedBuffers('library');
        expect(audioBufferCache.has('rec-discarded')).toBe(false);
    });

    it('still evicts a buffer nothing references', () => {
        cacheAudioBuffer({ buffer: createAudioBuffer(), bufferId: 'orphan' });
        fillCacheWithUnrelatedBuffers('library');
        expect(audioBufferCache.has('orphan')).toBe(false);
    });
});
