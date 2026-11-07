import { Buffer } from 'node:buffer';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    cacheAudioBuffer,
    clearRuntimeCachedAudioBuffers,
    configureDurableAudioBufferOwnership,
    configureLiveAudioBufferReferences,
    getAudioContext,
    getCachedAudioBuffer,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    captureUndoHistory,
    clearUndoHistory,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    recordActionHistoryEntries,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { type Track } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';
import { setArrangementEventBus } from '../arrangementEventBus';
import { collaborationAssetTransfer } from '../collaborationAssetTransfer';
import { createTrack } from '../createTrack';
import { getArrangementHandlers } from '../getArrangementHandlers';
import { importAudioClipToTrack } from '../importAudioClipToTrack';
import { importAudioFile } from '../importAudioFile';

const decoding = { decode: vi.fn<AudioContext['decodeAudioData']>() };

const assets = {
    stageLocalAsset: vi.fn<(blob: Blob, name: string) => Promise<{ hash: string; leaseId: string }>>(),
    promoteStagedAsset: vi.fn(() => true),
    releaseStagedAsset: vi.fn(),
    promoteDurableStagedAsset: vi.fn(),
    requestAsset: vi.fn(),
};
collaborationAssetTransfer.configure({ current: () => assets, isSessionActive: () => false });

type RawRoot = { tracks?: { tracks: Track[] } };
const CACHE_CAPACITY = 64;

function pcmBuffer(length = 48_000): AudioBuffer {
    const channels = [new Float32Array(length), new Float32Array(length)];
    for (let frame = 0; frame < length; frame++) {
        channels[0]![frame] = (frame % 257) / 257;
        channels[1]![frame] = -(frame % 113) / 113;
    }
    return {
        duration: length / 48_000,
        length,
        numberOfChannels: channels.length,
        sampleRate: 48_000,
        getChannelData: (channel) => channels[channel]!,
        copyFromChannel: (target, channel, offset = 0) =>
            target.set(channels[channel]!.subarray(offset, offset + target.length)),
        copyToChannel: (source, channel, offset = 0) => channels[channel]!.set(source, offset),
    };
}

function pressureCache(prefix: string): void {
    for (let index = 0; index < CACHE_CAPACITY; index++) {
        cacheAudioBuffer({ bufferId: `${prefix}-${index}`, buffer: pcmBuffer(1) });
    }
}

function rawClips() {
    return getCrdtDoc<RawRoot>('root')?.tracks?.tracks.flatMap((track) => track.clips) ?? [];
}

function settleAudioPersistence(): Promise<void> {
    return withProjectAudioStorageLock(() => Promise.resolve());
}

function sourceFile(): File {
    const file = new File([new Uint8Array(8)], 'source.wav');
    // jsdom's File lacks arrayBuffer; read the actual Blob through its FileReader.
    Object.defineProperty(file, 'arrayBuffer', {
        value: () =>
            new Promise<ArrayBuffer>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    if (reader.result instanceof ArrayBuffer) {
                        resolve(reader.result);
                    } else {
                        reject(new Error('The fixture file did not produce binary data'));
                    }
                };
                reader.onerror = () => reject(reader.error ?? new Error('Fixture file read failed'));
                reader.readAsArrayBuffer(file);
            }),
    });
    return file;
}

function holdAssetStaging() {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<{ hash: string; leaseId: string }>();
    assets.stageLocalAsset.mockImplementationOnce(() => {
        entered.resolve();
        return release.promise;
    });
    return {
        entered: entered.promise,
        release: () => release.resolve({ hash: 'original-hash', leaseId: 'lease' }),
        fail: () => release.reject(new Error('Original asset IO failed')),
    };
}

function importFile(route: 'existing' | 'new', shouldContinue = () => true) {
    const file = sourceFile();
    if (route === 'existing') {
        return importAudioClipToTrack('target', file, { shouldContinue });
    }
    return importAudioFile(file, { shouldContinue });
}

describe('manual imported audio residency through typed placement', () => {
    let installation: ReturnType<typeof installTransactionalIndexedDb>;
    let cacheWrites: MockInstance<typeof audioBufferCache.set>;
    let context: ReturnType<typeof getAudioContext>;
    let originalDecode: PropertyDescriptor | undefined;

    beforeAll(() => {
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        installation = installTransactionalIndexedDb();
        context = getAudioContext();
        originalDecode = Object.getOwnPropertyDescriptor(context, 'decodeAudioData');
        Object.defineProperty(context, 'decodeAudioData', { configurable: true, value: decoding.decode });
    });
    afterAll(async () => {
        await settleAudioPersistence();
        await installation.dispose();
        if (originalDecode) {
            Object.defineProperty(context, 'decodeAudioData', originalDecode);
        } else {
            Reflect.deleteProperty(context, 'decodeAudioData');
        }
        vi.unstubAllGlobals();
    });
    beforeEach(async () => {
        vi.clearAllMocks();
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('manual import residency test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        setArrangementEventBus({ emit: () => Promise.resolve() });
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            recordBatch: recordActionHistoryEntries,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        projectStore.set(structuredClone(defaultProjectStoreState));
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        trackStore.set({
            tracks: [createTrack({ id: 'target', name: 'Audio', kind: 'audio' })],
            selectedTrackId: 'target',
        });
        flushAutomergeStorageWrites();
        configureLiveAudioBufferReferences(() =>
            (trackStore.value?.tracks ?? []).flatMap((track) =>
                track.clips.flatMap((clip) => (clip.audioBufferId ? [clip.audioBufferId] : []))
            )
        );
        configureDurableAudioBufferOwnership(() => Promise.resolve([]));
        await clearRuntimeCachedAudioBuffers();
        cacheWrites = vi.spyOn(audioBufferCache, 'set');
        decoding.decode.mockResolvedValue(pcmBuffer());
    });
    afterEach(async () => {
        vi.restoreAllMocks();
        configureLiveAudioBufferReferences(null);
        await settleAudioPersistence();
        await clearRuntimeCachedAudioBuffers();
        await settleAudioPersistence();
        configureDurableAudioBufferOwnership(null);
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(['existing', 'new'] as const)(
        '%s track retains staging PCM, commits exact source, and releases its temporary hold',
        async (route) => {
            const source = pcmBuffer();
            const expectedChannels = Array.from({ length: source.numberOfChannels }, (_, channel) =>
                source.getChannelData(channel).slice()
            );
            decoding.decode.mockResolvedValueOnce(source);
            const stage = holdAssetStaging();
            const pending = importFile(route);
            await stage.entered;
            const id = cacheWrites.mock.calls[0]![0];
            expect(id).toMatch(/^audio-/);
            expect(rawClips()).toEqual([]);
            expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
            try {
                pressureCache('while-staging');
                expect(
                    getCachedAudioBuffer({ bufferId: id }),
                    'pending imported PCM must remain resident before addClip'
                ).toBe(source);
            } finally {
                stage.release();
                await pending;
            }
            const clips = trackStore.value!.tracks.flatMap((track) => track.clips);
            expect(clips).toHaveLength(1);
            expect(clips[0]).toMatchObject({
                audioBufferId: id,
                assetHash: 'original-hash',
                startBeat: 0,
                endBeat: route === 'existing' ? 2 : 4,
            });
            expect(rawClips()).toEqual(clips);
            expect(captureUndoHistory().past).toHaveLength(route === 'existing' ? 1 : 2);
            expect(captureUndoHistory().past.every((entry) => entry.kind === 'action')).toBe(true);
            expect(captureUndoHistory().past[0]?.groupLabel).toBe('Import audio: source');
            expect(actionHistoryStore.value?.entries).toHaveLength(route === 'existing' ? 1 : 2);
            expect(assets.promoteStagedAsset).toHaveBeenCalledWith('lease');
            expect(assets.releaseStagedAsset).not.toHaveBeenCalled();
            pressureCache('after-commit');
            const resident = getCachedAudioBuffer({ bufferId: id });
            expect(resident).toBe(source);
            for (let channel = 0; channel < source.numberOfChannels; channel++) {
                expect(
                    Buffer.compare(
                        Buffer.from(resident!.getChannelData(channel).buffer),
                        Buffer.from(expectedChannels[channel]!.buffer)
                    )
                ).toBe(0);
            }

            // Release the actual clip owner and history before testing that the temporary hold ended.
            await undo();
            expect(rawClips()).toEqual([]);
            clearUndoHistory();
            expect(getCachedAudioBuffer({ bufferId: id })).toBe(source);
            pressureCache('after-owner-retired');
            expect(getCachedAudioBuffer({ bufferId: id })).toBeNull();
        }
    );

    it.each([
        ['existing', 'cancel'],
        ['existing', 'asset-failure'],
        ['new', 'cancel'],
        ['new', 'asset-failure'],
    ] as const)('%s track %s releases decoded material, staged resources and the hold', async (route, outcome) => {
        let current = true;
        const stage = holdAssetStaging();
        const pending = importFile(route, () => current);
        await stage.entered;
        const id = cacheWrites.mock.calls[0]![0];
        if (outcome === 'cancel') {
            current = false;
            stage.release();
        } else {
            stage.fail();
        }
        await expect(pending).resolves.toBe(outcome === 'cancel' ? 'superseded' : 'completed');
        expect(rawClips()).toEqual([]);
        expect(trackStore.value?.tracks.flatMap((track) => track.clips)).toEqual([]);
        expect(captureUndoHistory().past).toEqual([]);
        expect(getCachedAudioBuffer({ bufferId: id })).toBeNull();
        expect(assets.promoteStagedAsset).not.toHaveBeenCalled();
        if (outcome === 'cancel') {
            expect(assets.releaseStagedAsset).toHaveBeenCalledWith('lease');
        } else {
            expect(assets.releaseStagedAsset).not.toHaveBeenCalled();
        }
        // Deletion alone cannot prove the hold ended: reusing the unowned ID must be evictable.
        cacheAudioBuffer({ bufferId: id, buffer: pcmBuffer() });
        pressureCache('after-terminal-cleanup');
        expect(getCachedAudioBuffer({ bufferId: id })).toBeNull();
    });
});
