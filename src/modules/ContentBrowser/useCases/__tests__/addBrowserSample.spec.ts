import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { addBrowserSample } from '../addBrowserSample';

const mocks = vi.hoisted(() => ({
    trackState: {
        value: { tracks: [] as { id: string; kind: string; clips: [] }[], selectedTrackId: null as string | null },
    },
    ensureFactorySampleBuffer: vi.fn(),
    stageClipAudioAsset: vi.fn(),
    getAssetTransfer: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    trackStore: {
        get value() {
            return mocks.trackState.value;
        },
        subscribe: () => () => {},
    },
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    stageClipAudioAsset: mocks.stageClipAudioAsset,
}));

vi.mock('#/modules/SampleLibrary/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    ensureFactorySampleBuffer: mocks.ensureFactorySampleBuffer,
}));

vi.mock('#/modules/Collaboration/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getAssetTransfer: mocks.getAssetTransfer,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getCachedAudioBuffer: vi.fn(),
    restoreUnpinnedAudioBuffersFromIdb: vi.fn().mockResolvedValue({
        absentIds: [],
        initiallyUncachedIds: [],
        restoredBuffers: new Map<string, AudioBuffer>(),
        release: vi.fn(),
    }),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

// A bare test has no loaded project, so the real authority is never current.
vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    captureProjectTransitionAuthority: () => ({ isCurrent: () => true }),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    executeAppActionBatch: vi.fn(),
}));

type BatchAction = { type: string; payload: Record<string, unknown> };

const dispatched = (type: string): BatchAction | undefined =>
    vi
        .mocked(executeAppActionBatch)
        .mock.calls.flatMap((call) => call[0] as BatchAction[])
        .find((action) => action.type === type);

const bufferOf = (duration: number): AudioBuffer => ({
    copyFromChannel: vi.fn<(destination: Float32Array, channelNumber: number, bufferOffset?: number) => void>(),
    copyToChannel: vi.fn<(source: Float32Array, channelNumber: number, bufferOffset?: number) => void>(),
    duration,
    getChannelData: vi.fn<(channelNumber: number) => Float32Array<ArrayBuffer>>(() => new Float32Array(1)),
    length: 1,
    numberOfChannels: 1,
    sampleRate: 44100,
});

describe('addBrowserSample', () => {
    beforeEach(() => {
        vi.mocked(getCachedAudioBuffer).mockReset();
        vi.mocked(getCachedAudioBuffer).mockReturnValue(bufferOf(4));
        vi.mocked(executeAppActionBatch).mockReset();
        vi.mocked(executeAppActionBatch).mockResolvedValue({ status: 'committed', actions: [] });
        mocks.ensureFactorySampleBuffer.mockReset();
        mocks.ensureFactorySampleBuffer.mockResolvedValue({ status: 'not-factory' });
        mocks.notifyUser.mockReset();
        mocks.stageClipAudioAsset.mockReset();
        mocks.stageClipAudioAsset.mockResolvedValue(null);
        mocks.getAssetTransfer.mockReturnValue({
            stageLocalAsset: vi.fn(),
            releaseStagedAsset: vi.fn(),
            promoteStagedAsset: vi.fn(),
        });
        mocks.trackState.value = { tracks: [{ id: 't1', kind: 'audio', clips: [] }], selectedTrackId: 't1' };
        transportStore.set({ ...defaultTransportState, tempo: 60, isPlaying: false, playheadPosition: 0 });
    });

    it('puts the clip on the selected audio track', async () => {
        await addBrowserSample({ id: 's1', name: 'Kick', audioBufferId: 'b1' });

        expect(dispatched('addTrack')).toBeUndefined();
        expect(dispatched('addClip')?.payload).toEqual(
            expect.objectContaining({ trackId: 't1', audioBufferId: 'b1', startBeat: 0, endBeat: 4 })
        );
    });

    it('gives the sample a new audio track when the selected track is a MIDI track', async () => {
        mocks.trackState.value = { tracks: [{ id: 'm1', kind: 'midi', clips: [] }], selectedTrackId: 'm1' };

        await addBrowserSample({ id: 's1', name: 'Kick', audioBufferId: 'b1' });

        const addTrack = dispatched('addTrack');
        expect(addTrack?.payload).toEqual(expect.objectContaining({ name: 'Kick', kind: 'audio' }));
        const clip = dispatched('addClip');
        expect(clip?.payload.trackId).toBe(addTrack?.payload.id);
        expect(clip?.payload.trackId).not.toBe('m1');
    });

    it('gives the sample a new audio track when no track is selected', async () => {
        mocks.trackState.value = { tracks: [], selectedTrackId: null };

        await addBrowserSample({ id: 's1', name: 'Kick', audioBufferId: 'b1' });

        expect(dispatched('addTrack')?.payload).toEqual(expect.objectContaining({ name: 'Kick', kind: 'audio' }));
    });

    it('starts the clip at the playhead beat', async () => {
        transportStore.set({ ...defaultTransportState, tempo: 60, isPlaying: false, playheadPosition: 12 });

        await addBrowserSample({ id: 's1', name: 'Kick', audioBufferId: 'b1' });

        expect(dispatched('addClip')?.payload).toEqual(expect.objectContaining({ startBeat: 12, endBeat: 16 }));
    });

    it('re-obtains an uncached factory sample buffer before placing it', async () => {
        const factoryBuffer = bufferOf(2);
        vi.mocked(getCachedAudioBuffer).mockReturnValueOnce(null).mockReturnValue(factoryBuffer);
        mocks.ensureFactorySampleBuffer.mockResolvedValue({ status: 'resolved', buffer: factoryBuffer });

        await addBrowserSample({ id: 'factory-kick', name: 'Factory Kick' });

        expect(mocks.ensureFactorySampleBuffer).toHaveBeenCalledWith({ sampleId: 'factory-kick' });
        expect(dispatched('addClip')?.payload).toEqual(
            expect.objectContaining({ trackId: 't1', audioBufferId: 'factory-kick', endBeat: 2 })
        );
    });

    it('places nothing when the sample has no audio to place', async () => {
        vi.mocked(getCachedAudioBuffer).mockReturnValue(null);
        mocks.ensureFactorySampleBuffer.mockResolvedValue({ status: 'unavailable' });

        await addBrowserSample({ id: 'gone', name: 'Gone' });

        expect(executeAppActionBatch).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('Gone'), 'error');
    });
});
