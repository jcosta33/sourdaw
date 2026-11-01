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
import { defaultTrackState, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import {
    addClip,
    createTrack,
    readUndoEntriesAudioBufferIds,
    readUndoHistoryAudioBufferIds,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    cacheAudioBuffer,
    configureDurableAudioBufferOwnership,
    configureHistoryAudioBufferReferences,
    configureLiveAudioBufferReferences,
    prepareCachedAudioBuffersForReplay,
} from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { macroStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
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

import { duplicateSelectedClipsForward } from '../duplicateSelectedClipsForward';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

/** The runtime cache's LRU cap; one more unrelated write than this evicts anything unprotected. */
const CACHE_CAPACITY = 64;
const BUFFER_ID = 'clip-a-audio';

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

function writeUnrelatedBuffers(): void {
    for (let index = 0; index <= CACHE_CAPACITY; index++) {
        cacheAudioBuffer({ buffer: createAudioBuffer(), bufferId: `import-${index}` });
    }
}

function liveBufferIds(): string[] {
    const ids: string[] = [];
    for (const clip of trackStore.value?.tracks.flatMap((track) => track.clips) ?? []) {
        if (clip.audioBufferId !== undefined) {
            ids.push(clip.audioBufferId);
        }
    }
    return ids;
}

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

/**
 * Duplicates clip A, undoes the duplicate, then removes A outside the history
 * (a collaborator's edit, a script): only the duplicate's redo still names A's
 * buffer.
 */
async function leaveBufferNamedOnlyByTheRedo(): Promise<void> {
    duplicateSelectedClipsForward(['clip-a']);
    await undo();
    const state = trackStore.value;
    if (!state) {
        throw new Error('expected a track state');
    }
    trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, clips: [] })) });
}

describe('duplicateSelectedClipsForward buffer residency (#6003)', () => {
    let installation: TransactionalIndexedDbInstallation;

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
        resetCrdtProjectAuthority('duplicate forward buffer residency');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        configureLiveAudioBufferReferences(liveBufferIds);
        configureHistoryAudioBufferReferences(readUndoHistoryAudioBufferIds);
        undoReplayPreparationPort.setProvider((entries) =>
            prepareCachedAudioBuffersForReplay([...readUndoEntriesAudioBufferIds(entries)])
        );
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'track-1', name: 'Track 1', kind: 'audio' })],
            selectedTrackId: 'track-1',
        });
        cacheAudioBuffer({ buffer: createAudioBuffer(0.25), bufferId: BUFFER_ID });
        addClip({
            id: 'clip-a',
            trackId: 'track-1',
            startBeat: 0,
            endBeat: 4,
            name: 'Clip A',
            type: 'audio',
            audioBufferId: BUFFER_ID,
        });
    });

    afterEach(async () => {
        configureLiveAudioBufferReferences(null);
        configureHistoryAudioBufferReferences(null);
        undoReplayPreparationPort.setProvider(null);
        configureDurableAudioBufferOwnership(() => Promise.resolve([]));
        clearUndoHistory();
        resetActionReplayAuthority();
        setTrackStoreState(structuredClone(defaultTrackState));
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        await settleAudioPersistence();
        audioBufferCache.clear();
        await settleAudioPersistence();
        configureDurableAudioBufferOwnership(null);
    });

    it('keeps the buffer only its redo names resident while it is not yet stored', async () => {
        const persistence = holdAudioPersistence();
        try {
            await leaveBufferNamedOnlyByTheRedo();
            writeUnrelatedBuffers();
            expect(audioBufferCache.has(BUFFER_ID)).toBe(true);

            await redo();
            expect(liveBufferIds()).toEqual([BUFFER_ID]);
            expect(audioBufferCache.get(BUFFER_ID)?.getChannelData(0)[0]).toBe(0.25);
        } finally {
            await persistence.release();
        }
    });

    it('rehydrates the stored buffer only its redo names before the redo re-creates the copy', async () => {
        await leaveBufferNamedOnlyByTheRedo();
        await settleAudioPersistence();
        writeUnrelatedBuffers();
        expect(audioBufferCache.has(BUFFER_ID)).toBe(false);

        await redo();
        expect(liveBufferIds()).toEqual([BUFFER_ID]);
        expect(audioBufferCache.get(BUFFER_ID)?.getChannelData(0)[0]).toBe(0.25);
    });
});
