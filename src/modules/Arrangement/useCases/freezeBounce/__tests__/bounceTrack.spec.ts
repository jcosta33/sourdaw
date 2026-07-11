import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeTrack, type Clip, type Track } from '../../../models/Track';
import { bounceTrack, type BounceOptions } from '../bounceTrack';

import type { TrackStoreState } from '../../../stores/trackStore';

type CacheAudioBufferInput = {
    buffer: AudioBuffer;
    bufferId?: string;
};

type RenderTrackOffline = (
    track: Track,
    startBeat: number,
    endBeat: number,
    options?: unknown
) => Promise<AudioBuffer | null>;

type PushUndoEntry = (label: string, undoFn: () => void, redoFn: () => void) => void;

type TestTransportStore = {
    value: { tempo: number } | null;
};

type TestTrackStore = {
    value: TrackStoreState | null;
    set: ReturnType<typeof vi.fn<(state: TrackStoreState) => void>>;
};

const mocks = vi.hoisted(() => {
    const trackStore: TestTrackStore = {
        value: null,
        set: vi.fn<(state: TrackStoreState) => void>(),
    };
    const transportStore: TestTransportStore = {
        value: { tempo: 120 },
    };

    return {
        cacheAudioBuffer: vi.fn<(input: CacheAudioBufferInput) => string>(),
        pushUndoEntry: vi.fn<PushUndoEntry>(),
        renderTrackOffline: vi.fn<RenderTrackOffline>(),
        trackStore,
        transportStore,
    };
});

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: mocks.transportStore,
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: mocks.trackStore,
}));

vi.mock('../renderOffline', () => ({
    renderTrackOffline: mocks.renderTrackOffline,
}));

function createTestAudioBuffer(): AudioBuffer {
    const channelData = new Float32Array(128);

    return {
        copyFromChannel: vi.fn((destination: Float32Array, _channelNumber: number, bufferOffset = 0) => {
            destination.set(channelData.subarray(bufferOffset, bufferOffset + destination.length));
        }),
        copyToChannel: vi.fn((source: Float32Array, _channelNumber: number, bufferOffset = 0) => {
            channelData.set(source, bufferOffset);
        }),
        duration: 1,
        getChannelData: vi.fn(() => channelData),
        length: channelData.length,
        numberOfChannels: 2,
        sampleRate: 48000,
    };
}

function createAudioClip(overrides: Partial<Clip>): Clip {
    return {
        id: 'clip-1',
        trackId: 'track-1',
        name: 'Audio Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        audioBufferId: 'source-buffer-1',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function createAudioTrack(overrides: Partial<Track> = {}): Track {
    return normalizeTrack({
        id: 'track-1',
        name: 'Guitar',
        kind: 'audio',
        clips: [createAudioClip({})],
        ...overrides,
    });
}

function setTrackStoreState(state: TrackStoreState): void {
    mocks.trackStore.value = state;
}

function getFirstUndoEntry(): [string, () => void, () => void] {
    const call = mocks.pushUndoEntry.mock.calls[0];
    if (!call) {
        throw new Error('Expected an undo entry to be pushed');
    }

    return [call[0], call[1], call[2]];
}

describe('bounceTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(1234567890);
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');

        mocks.trackStore.set.mockImplementation((state) => {
            mocks.trackStore.value = state;
        });
        mocks.transportStore.value = { tempo: 120 };
        mocks.cacheAudioBuffer.mockImplementation((input) => input.bufferId ?? 'generated-buffer-id');
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should cache full-track bounce through the AudioEngine use case and preserve undo snapshots', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const sourceClip = createAudioClip({ id: 'clip-source', startBeat: 2, endBeat: 8 });
        const sourceTrack = createAudioTrack({
            clips: [sourceClip],
            devices: [{ id: 'device-1', name: 'EQ', type: 'eq', bypassed: false, parameterValues: {} }],
        });
        const options: BounceOptions = {
            includeInserts: true,
            includeSends: false,
            includeAutomation: true,
            normalization: 'protection',
            tailHandling: 'off',
            destination: 'replace',
        };

        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);

        await bounceTrack('track-1', options);

        const expectedBufferId = 'bounce-track-1-1234567890';
        expect(mocks.renderTrackOffline).toHaveBeenCalledWith(sourceTrack, 2, 8, {
            includeInserts: true,
            includeSends: false,
            includeAutomation: true,
            normalization: 'protection',
            autoTail: false,
        });
        expect(mocks.cacheAudioBuffer).toHaveBeenCalledWith({ buffer: renderedBuffer, bufferId: expectedBufferId });

        const bouncedTrack = mocks.trackStore.value?.tracks[0];
        const bouncedClip = bouncedTrack?.clips[0];
        expect(bouncedClip).toEqual(
            expect.objectContaining({
                id: 'bounced-clip-11111111-1111-4111-8111-111111111111',
                trackId: 'track-1',
                name: 'Guitar (bounced)',
                startBeat: 2,
                endBeat: 8,
                audioBufferId: expectedBufferId,
            })
        );
        expect(bouncedTrack?.devices).toEqual([]);

        const [label, undo, redo] = getFirstUndoEntry();
        expect(label).toBe('Bounce Track');

        undo();
        expect(mocks.trackStore.value?.tracks).toEqual([sourceTrack]);

        redo();
        expect(mocks.trackStore.value?.tracks[0]?.clips[0]).toEqual(bouncedClip);
    });
});
