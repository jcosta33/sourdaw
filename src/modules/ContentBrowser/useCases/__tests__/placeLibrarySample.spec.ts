import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeAppActionBatch } from '#/modules/Command/useCases';

import { placeLibrarySample } from '../placeLibrarySample';

const mocks = vi.hoisted(() => ({
    tracks: { value: { tracks: [] as { id: string; kind: string; clips: [] }[], selectedTrackId: null } },
    getCachedAudioBuffer: vi.fn(),
    decodeAudioFile: vi.fn(),
    discardDecodedAudioFileIfCurrent: vi.fn(),
    restoreUnpinnedAudioBuffersFromIdb: vi.fn(),
    releaseAudio: vi.fn(),
    ensureFactorySampleBuffer: vi.fn(),
    resolveDroppedSampleFile: vi.fn(),
    rememberLibraryAssetMapping: vi.fn(),
    stageClipAudioAsset: vi.fn(),
    getAssetTransfer: vi.fn(),
    notifyUser: vi.fn(),
    stageLocalAsset: vi.fn(),
    releaseStagedAsset: vi.fn(),
    promoteStagedAsset: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    trackStore: {
        get value() {
            return mocks.tracks.value;
        },
        subscribe: () => () => {},
    },
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    stageClipAudioAsset: mocks.stageClipAudioAsset,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

vi.mock('#/modules/SampleLibrary/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    ensureFactorySampleBuffer: mocks.ensureFactorySampleBuffer,
    resolveDroppedSampleFile: mocks.resolveDroppedSampleFile,
    rememberLibraryAssetMapping: mocks.rememberLibraryAssetMapping,
}));

vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getAssetTransfer: mocks.getAssetTransfer,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
    decodeAudioFile: mocks.decodeAudioFile,
    discardDecodedAudioFileIfCurrent: mocks.discardDecodedAudioFileIfCurrent,
    restoreUnpinnedAudioBuffersFromIdb: mocks.restoreUnpinnedAudioBuffersFromIdb,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    executeAppActionBatch: vi.fn(),
}));

type BatchAction = { type: string; payload: Record<string, unknown> };

const clipPayload = (): Record<string, unknown> | undefined =>
    vi
        .mocked(executeAppActionBatch)
        .mock.calls.flatMap((call) => call[0] as BatchAction[])
        .find((action) => action.type === 'addClip')?.payload;

const bufferOf = (duration: number): AudioBuffer => ({
    copyFromChannel: vi.fn<(destination: Float32Array, channelNumber: number, bufferOffset?: number) => void>(),
    copyToChannel: vi.fn<(source: Float32Array, channelNumber: number, bufferOffset?: number) => void>(),
    duration,
    getChannelData: vi.fn<(channelNumber: number) => Float32Array<ArrayBuffer>>(() => new Float32Array(1)),
    length: 1,
    numberOfChannels: 1,
    sampleRate: 44100,
});

const authority = { isCurrent: () => true };
const place = (sample: Parameters<typeof placeLibrarySample>[0]['sample'], trackId?: string) =>
    placeLibrarySample({
        sample,
        placement: { trackId, startBeat: 8 },
        authority,
        origin: 'browser-add',
        readTempo: () => 120,
    });

describe('placeLibrarySample', () => {
    beforeEach(() => {
        for (const mock of Object.values(mocks)) {
            if (typeof mock === 'function') {
                mock.mockReset();
            }
        }
        mocks.tracks.value = { tracks: [{ id: 't1', kind: 'audio', clips: [] }], selectedTrackId: null };
        mocks.getCachedAudioBuffer.mockReturnValue(bufferOf(2));
        mocks.restoreUnpinnedAudioBuffersFromIdb.mockResolvedValue({
            absentIds: [],
            initiallyUncachedIds: [],
            restoredBuffers: new Map<string, AudioBuffer>(),
            release: mocks.releaseAudio,
        });
        mocks.ensureFactorySampleBuffer.mockResolvedValue({ status: 'not-factory' });
        mocks.stageClipAudioAsset.mockResolvedValue({ hash: 'h', leaseId: 'lease' });
        mocks.getAssetTransfer.mockReturnValue({
            stageLocalAsset: mocks.stageLocalAsset,
            releaseStagedAsset: mocks.releaseStagedAsset,
            promoteStagedAsset: mocks.promoteStagedAsset,
        });
        mocks.promoteStagedAsset.mockReturnValue(true);
        vi.mocked(executeAppActionBatch).mockReset();
        vi.mocked(executeAppActionBatch).mockResolvedValue({ status: 'committed', actions: [] });
    });

    it('places a cached buffer at the requested beat with its staged hash, then promotes the lease once', async () => {
        await place({ id: 's1', name: 'Kick', audioBufferId: 'b1' }, 't1');

        expect(mocks.ensureFactorySampleBuffer).not.toHaveBeenCalled();
        expect(clipPayload()).toEqual(
            expect.objectContaining({ trackId: 't1', startBeat: 8, audioBufferId: 'b1', assetHash: 'h' })
        );
        expect(mocks.promoteStagedAsset).toHaveBeenCalledTimes(1);
        expect(mocks.promoteStagedAsset).toHaveBeenCalledWith('lease');
        expect(mocks.releaseStagedAsset).not.toHaveBeenCalled();
        expect(mocks.restoreUnpinnedAudioBuffersFromIdb).toHaveBeenCalledWith({
            bufferIds: ['b1'],
            isCurrent: authority.isCurrent,
        });
        expect(mocks.releaseAudio).toHaveBeenCalledTimes(1);
    });

    it('refuses commit admission when preflight replaces the exact cached PCM', async () => {
        const original = mocks.getCachedAudioBuffer({ bufferId: 'b1' });
        const replacement = bufferOf(2);
        let admitted: boolean | undefined;
        vi.mocked(executeAppActionBatch).mockImplementation(async (_actions, options) => {
            mocks.getCachedAudioBuffer.mockReturnValue(replacement);
            admitted = options?.shouldExecute?.() ?? true;
            if (admitted) {
                return { status: 'committed', actions: [] };
            }
            return { status: 'cancelled', reason: 'PCM replaced', actions: [] };
        });

        await place({ id: 's1', name: 'Kick', audioBufferId: 'b1' }, 't1');

        expect(original).not.toBe(replacement);
        expect(admitted).toBe(false);
        expect(mocks.releaseStagedAsset).toHaveBeenCalledWith('lease');
        expect(mocks.promoteStagedAsset).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
    });

    it('falls back to the factory buffer when nothing is cached and keys the clip by the sample id', async () => {
        const factoryBuffer = bufferOf(1);
        mocks.getCachedAudioBuffer.mockReturnValueOnce(null).mockReturnValue(factoryBuffer);
        mocks.ensureFactorySampleBuffer.mockResolvedValue({ status: 'resolved', buffer: factoryBuffer });

        await place({ id: 'factory-kick', name: 'Kick' }, 't1');

        expect(mocks.ensureFactorySampleBuffer).toHaveBeenCalledWith({ sampleId: 'factory-kick' });
        expect(clipPayload()).toEqual(expect.objectContaining({ audioBufferId: 'factory-kick' }));
    });

    it('does not stage a factory buffer after its awaited lookup loses project authority', async () => {
        let announceLookup!: () => void;
        const lookupStarted = new Promise<void>((resolve) => {
            announceLookup = resolve;
        });
        let resolveLookup!: (result: { status: 'resolved'; buffer: AudioBuffer }) => void;
        mocks.getCachedAudioBuffer.mockReturnValue(null);
        mocks.ensureFactorySampleBuffer.mockImplementation(() => {
            announceLookup();
            return new Promise((resolve) => {
                resolveLookup = resolve;
            });
        });
        let current = true;
        const placement = placeLibrarySample({
            sample: { id: 'factory-kick', name: 'Kick' },
            placement: { trackId: 't1', startBeat: 8 },
            authority: { isCurrent: () => current },
            origin: 'browser-add',
            readTempo: () => 120,
        });
        await lookupStarted;
        current = false;
        resolveLookup({ status: 'resolved', buffer: bufferOf(1) });
        await placement;
        expect(mocks.stageClipAudioAsset).not.toHaveBeenCalled();
        expect(executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.releaseAudio).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('decodes and stages a library file when no buffer exists, and binds the hash to the library path', async () => {
        const decodedBuffer = bufferOf(3);
        mocks.getCachedAudioBuffer.mockReturnValueOnce(null).mockReturnValue(decodedBuffer);
        const file = new File(['x'], 'Loop.wav');
        mocks.resolveDroppedSampleFile.mockResolvedValue({ status: 'resolved', file });
        mocks.decodeAudioFile.mockResolvedValue({ id: 'decoded-id', buffer: decodedBuffer });
        mocks.stageLocalAsset.mockResolvedValue({ hash: 'file-hash', leaseId: 'file-lease' });
        mocks.rememberLibraryAssetMapping.mockResolvedValue(true);

        await place({ id: 's2', name: 'Loop', libraryRootId: 'root', path: 'a/Loop.wav' }, 't1');

        expect(mocks.resolveDroppedSampleFile).toHaveBeenCalledWith({
            libraryRootId: 'root',
            relativePath: 'a/Loop.wav',
            fallbackName: 'Loop',
        });
        expect(clipPayload()).toEqual(
            expect.objectContaining({ audioBufferId: 'decoded-id', assetHash: 'file-hash', endBeat: 8 + 6 })
        );
        expect(mocks.promoteStagedAsset).toHaveBeenCalledWith('file-lease');
        expect(mocks.rememberLibraryAssetMapping).toHaveBeenCalledWith(
            expect.objectContaining({
                hash: 'file-hash',
                sampleId: 's2',
                libraryRootId: 'root',
                relativePath: 'a/Loop.wav',
            })
        );
        expect(mocks.discardDecodedAudioFileIfCurrent).not.toHaveBeenCalled();
    });

    it('notifies and writes nothing when staging the cached audio fails', async () => {
        mocks.stageClipAudioAsset.mockRejectedValue(new Error('no'));

        await place({ id: 's1', name: 'Kick', audioBufferId: 'b1' }, 't1');

        expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to import "Kick" — asset registration failed', 'error');
        expect(executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.promoteStagedAsset).not.toHaveBeenCalled();
    });

    it('releases the staged lease and the decoded buffer when staging a library file fails', async () => {
        const decodedBuffer = bufferOf(3);
        mocks.getCachedAudioBuffer.mockReturnValueOnce(null).mockReturnValue(decodedBuffer);
        mocks.resolveDroppedSampleFile.mockResolvedValue({ status: 'resolved', file: new File(['x'], 'Loop.wav') });
        mocks.decodeAudioFile.mockResolvedValue({ id: 'decoded-id', buffer: decodedBuffer });
        mocks.stageLocalAsset.mockRejectedValue(new Error('no'));

        await place({ id: 's2', name: 'Loop', libraryRootId: 'root', path: 'a/Loop.wav' }, 't1');

        expect(mocks.discardDecodedAudioFileIfCurrent).toHaveBeenCalledWith('decoded-id', decodedBuffer);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to import "Loop" — asset registration failed', 'error');
        expect(executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('releases the staged lease when the batch reports no commit', async () => {
        vi.mocked(executeAppActionBatch).mockResolvedValue({ status: 'cancelled', reason: 'revoked', actions: [] });

        await place({ id: 's1', name: 'Kick', audioBufferId: 'b1' }, 't1');

        expect(mocks.releaseStagedAsset).toHaveBeenCalledWith('lease');
        expect(mocks.promoteStagedAsset).not.toHaveBeenCalled();
    });

    it('releases the staged lease when the batch throws', async () => {
        vi.mocked(executeAppActionBatch).mockRejectedValue(new Error('boom'));

        await place({ id: 's1', name: 'Kick', audioBufferId: 'b1' }, 't1');

        expect(mocks.releaseStagedAsset).toHaveBeenCalledWith('lease');
        expect(mocks.promoteStagedAsset).not.toHaveBeenCalled();
    });

    it('releases the staged lease when the target track is not an audio track', async () => {
        mocks.tracks.value = { tracks: [{ id: 'm1', kind: 'midi', clips: [] }], selectedTrackId: null };

        await place({ id: 's1', name: 'Kick', audioBufferId: 'b1' }, 'm1');

        expect(executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.releaseStagedAsset).toHaveBeenCalledWith('lease');
    });

    it('creates a new audio track named after the sample when no track is given', async () => {
        await place({ id: 's1', name: 'Kick', audioBufferId: 'b1' });

        const actions = vi.mocked(executeAppActionBatch).mock.calls.flatMap((call) => call[0] as BatchAction[]);
        expect(actions.map((action) => action.type)).toEqual(['addTrack', 'addClip']);
        expect(actions[0]?.payload).toEqual(expect.objectContaining({ name: 'Kick', kind: 'audio' }));
        expect(actions[1]?.payload.trackId).toBe(actions[0]?.payload.id);
    });
});
