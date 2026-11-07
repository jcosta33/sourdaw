import { Buffer } from 'node:buffer';

import { type ReactElement } from 'react';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
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
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { type Track } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';
import { setArrangementEventBus } from '../../useCases/arrangementEventBus';
import { collaborationAssetTransfer } from '../../useCases/collaborationAssetTransfer';
import { createTrack } from '../../useCases/createTrack';
import { getArrangementHandlers } from '../../useCases/getArrangementHandlers';
import { useTimelineFileDrop } from '../hooks/useTimelineFileDrop';
import { TimelineEmptyMenu } from '../views/TimelineEmptyMenu';

const decoding = vi.hoisted(() => ({ decode: vi.fn<(file: File) => Promise<AudioBuffer>>() }));
vi.mock('#/modules/AudioEngine/useCases/decodeAudioFileBuffer', () => ({ decodeAudioFileBuffer: decoding.decode }));

const assets = {
    stageLocalAsset: vi.fn<(blob: Blob, name: string) => Promise<{ hash: string; leaseId: string }>>(),
    promoteStagedAsset: vi.fn(() => true),
    releaseStagedAsset: vi.fn(),
    promoteDurableStagedAsset: vi.fn(),
    requestAsset: vi.fn(),
};
collaborationAssetTransfer.configure({ current: () => assets, isSessionActive: () => false });

vi.mock('#/modules/Collaboration/useCases', async (original) => ({
    ...(await original<typeof import('#/modules/Collaboration/useCases')>()),
    getAssetTransfer: () => assets,
}));

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

describe('manual timeline import residency through real placement', () => {
    let installation: ReturnType<typeof installTransactionalIndexedDb>;
    let cacheWrites: ReturnType<typeof vi.spyOn<typeof audioBufferCache, 'set'>>;

    beforeAll(() => {
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        installation = installTransactionalIndexedDb();
    });
    afterAll(async () => {
        await settleAudioPersistence();
        await installation.dispose();
        vi.unstubAllGlobals();
    });
    beforeEach(async () => {
        vi.clearAllMocks();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
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
        cleanup();
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

    async function expectCommittedSource(
        id: string,
        source: AudioBuffer,
        expectedChannels: Float32Array[],
        startBeat: number,
        endBeat: number
    ) {
        const clips = trackStore.value!.tracks.flatMap((track) => track.clips);
        expect(clips).toHaveLength(1);
        expect(clips[0]).toMatchObject({ audioBufferId: id, startBeat, endBeat });
        expect(rawClips()).toEqual(clips);
        expect(captureUndoHistory().past).toHaveLength(1);
        expect(actionHistoryStore.value?.entries).toHaveLength(1);
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
        await undo();
        expect(rawClips()).toEqual([]);
        clearUndoHistory();
        expect(getCachedAudioBuffer({ bufferId: id })).toBe(source);
        pressureCache('after-owner-retired');
        expect(getCachedAudioBuffer({ bufferId: id })).toBeNull();
    }

    it('file drop retains decoded PCM while original asset staging is held', async () => {
        const source = pcmBuffer();
        const expectedChannels = Array.from({ length: source.numberOfChannels }, (_, channel) =>
            source.getChannelData(channel).slice()
        );
        decoding.decode.mockResolvedValueOnce(source);
        const stage = holdAssetStaging();
        let pending: Promise<void> | undefined;
        function DropTarget(): ReactElement {
            const { handleFileDrop } = useTimelineFileDrop({
                getCanvasCoords: () => ({ x: 4, y: 0 }),
                getBeatFromX: () => 4,
            });
            return (
                <div
                    data-testid="drop-target"
                    onDrop={(event) => {
                        pending = handleFileDrop(event);
                    }}
                />
            );
        }
        render(<DropTarget />);
        fireEvent.drop(screen.getByTestId('drop-target'), {
            dataTransfer: {
                files: [new File([new Uint8Array(8)], 'source.wav', { type: 'audio/wav' })],
                getData: () => '',
            },
        });
        await stage.entered;
        const id = cacheWrites.mock.calls[0]![0];
        expect(rawClips()).toEqual([]);
        try {
            pressureCache('while-drop-staging');
            expect(getCachedAudioBuffer({ bufferId: id }), 'dropped PCM must survive pending asset staging').toBe(
                source
            );
        } finally {
            stage.release();
            await act(async () => {
                await pending;
            });
        }
        expect(assets.promoteStagedAsset).toHaveBeenCalledWith('lease');
        await expectCommittedSource(id, source, expectedChannels, 4, 8);
    });

    it('empty timeline menu retains PCM behind the actual snapshot transaction queue', async () => {
        const source = pcmBuffer();
        const expectedChannels = Array.from({ length: source.numberOfChannels }, (_, channel) =>
            source.getChannelData(channel).slice()
        );
        decoding.decode.mockResolvedValueOnce(source);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const transaction = transactSnapshot(async () => {
            entered.resolve();
            await release.promise;
        });
        await entered.promise;
        const chooserClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
        render(
            <TooltipProvider>
                <TimelineEmptyMenu x={0} y={0} trackId="target" beat={6} onClose={() => undefined} />
            </TooltipProvider>
        );
        fireEvent.click(screen.getByRole('menuitem', { name: 'Import Audio…' }));
        const input = chooserClick.mock.contexts[0];
        if (!(input instanceof HTMLInputElement) || !input.onchange) {
            throw new Error('The real Import Audio menu did not install a chooser handler');
        }
        Object.defineProperty(input, 'files', { value: [new File([new Uint8Array(8)], 'source.wav')] });
        const pending = input.onchange.call(input, new Event('change'));
        try {
            await vi.waitFor(() => expect(cacheWrites).toHaveBeenCalledTimes(1));
            const id = cacheWrites.mock.calls[0]![0];
            expect(rawClips()).toEqual([]);
            pressureCache('while-menu-queued');
            expect(getCachedAudioBuffer({ bufferId: id }), 'menu PCM must survive actual queued addClip').toBe(source);
        } finally {
            release.resolve();
            await transaction;
            await act(async () => {
                await pending;
            });
        }
        const id = cacheWrites.mock.calls[0]![0];
        await expectCommittedSource(id, source, expectedChannels, 6, 8);
    });

    function expectReleased(id: string): void {
        expect(rawClips()).toEqual([]);
        expect(trackStore.value?.tracks.flatMap((track) => track.clips)).toEqual([]);
        expect(captureUndoHistory().past).toEqual([]);
        expect(getCachedAudioBuffer({ bufferId: id })).toBeNull();
        cacheAudioBuffer({ bufferId: id, buffer: pcmBuffer() });
        pressureCache('after-cancel');
        expect(getCachedAudioBuffer({ bufferId: id })).toBeNull();
    }

    it('file drop releases its lease, decoded material and hold after a real project transition during staging', async () => {
        const stage = holdAssetStaging();
        let pending: Promise<void> | undefined;
        function DropTarget(): ReactElement {
            const { handleFileDrop } = useTimelineFileDrop({
                getCanvasCoords: () => ({ x: 4, y: 0 }),
                getBeatFromX: () => 4,
            });
            return (
                <div
                    data-testid="drop-target"
                    onDrop={(event) => {
                        pending = handleFileDrop(event);
                    }}
                />
            );
        }
        render(<DropTarget />);
        fireEvent.drop(screen.getByTestId('drop-target'), {
            dataTransfer: {
                files: [new File([new Uint8Array(8)], 'source.wav', { type: 'audio/wav' })],
                getData: () => '',
            },
        });
        await stage.entered;
        const id = cacheWrites.mock.calls[0]![0];
        try {
            const transition = runProjectLoadTransaction();
            expect(await transition.prepare()).toBe(true);
            expect(transition.activate()).toBe(true);
        } finally {
            stage.release();
            await act(async () => {
                await pending;
            });
        }
        expect(assets.releaseStagedAsset).toHaveBeenCalledWith('lease');
        expect(assets.promoteStagedAsset).not.toHaveBeenCalled();
        expectReleased(id);
    });

    it('empty timeline menu releases decoded material and hold when queued placement loses project authority', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const transaction = transactSnapshot(async () => {
            entered.resolve();
            await release.promise;
        });
        await entered.promise;
        const chooserClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
        render(
            <TooltipProvider>
                <TimelineEmptyMenu x={0} y={0} trackId="target" beat={6} onClose={() => undefined} />
            </TooltipProvider>
        );
        fireEvent.click(screen.getByRole('menuitem', { name: 'Import Audio…' }));
        const input = chooserClick.mock.contexts[0];
        if (!(input instanceof HTMLInputElement) || !input.onchange) {
            throw new Error('The real Import Audio menu did not install a chooser handler');
        }
        Object.defineProperty(input, 'files', { value: [new File([new Uint8Array(8)], 'source.wav')] });
        const pending = input.onchange.call(input, new Event('change'));
        try {
            await vi.waitFor(() => expect(cacheWrites).toHaveBeenCalledTimes(1));
            const transition = runProjectLoadTransaction();
            expect(await transition.prepare()).toBe(true);
            expect(transition.activate()).toBe(true);
        } finally {
            release.resolve();
            await transaction;
            await act(async () => {
                await pending;
            });
        }
        expectReleased(cacheWrites.mock.calls[0]![0]);
    });
});
