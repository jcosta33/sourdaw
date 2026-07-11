import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeTrack, type Clip, type Track } from '../../../models/Track';
import { bounceSelection } from '../bounceSelection';

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

type TestTrackStore = {
    value: TrackStoreState | null;
    set: ReturnType<typeof vi.fn<(state: TrackStoreState) => void>>;
};

const mocks = vi.hoisted(() => ({
    cacheAudioBuffer: vi.fn<(input: CacheAudioBufferInput) => string>(),
    pushUndoEntry: vi.fn<PushUndoEntry>(),
    renderTrackOffline: vi.fn<RenderTrackOffline>(),
    trackStore: {
        value: null,
        set: vi.fn<(state: TrackStoreState) => void>(),
    } satisfies TestTrackStore,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
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

describe('bounceSelection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(1234567890);
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');

        mocks.trackStore.set.mockImplementation((state) => {
            mocks.trackStore.value = state;
        });
        mocks.cacheAudioBuffer.mockImplementation((input) => input.bufferId ?? 'generated-buffer-id');
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should clip the selected range, cache the render, and preserve undo snapshots', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const beforeClip = createAudioClip({ id: 'clip-before', startBeat: 0, endBeat: 1 });
        const selectedClip = createAudioClip({ id: 'clip-selected', startBeat: 2, endBeat: 6 });
        const afterClip = createAudioClip({ id: 'clip-after', startBeat: 9, endBeat: 10 });
        const sourceTrack = createAudioTrack({
            clips: [beforeClip, selectedClip, afterClip],
        });

        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);

        await bounceSelection('track-1', 2, 6);

        const expectedBufferId = 'bounce-sel-track-1-1234567890';
        expect(mocks.renderTrackOffline).toHaveBeenCalledWith(
            expect.objectContaining({
                clips: [expect.objectContaining({ id: 'clip-selected', startBeat: 2, endBeat: 6 })],
            }),
            2,
            6
        );
        expect(mocks.cacheAudioBuffer).toHaveBeenCalledWith({ buffer: renderedBuffer, bufferId: expectedBufferId });

        const bouncedTrack = mocks.trackStore.value?.tracks[0];
        expect(bouncedTrack?.clips).toEqual([
            beforeClip,
            afterClip,
            expect.objectContaining({
                id: 'bounced-sel-11111111-1111-4111-8111-111111111111',
                trackId: 'track-1',
                name: 'Guitar (selection bounce)',
                startBeat: 2,
                endBeat: 6,
                audioBufferId: expectedBufferId,
            }),
        ]);

        const [label, undo, redo] = getFirstUndoEntry();
        expect(label).toBe('Bounce Selection');

        undo();
        expect(mocks.trackStore.value?.tracks).toEqual([sourceTrack]);

        redo();
        expect(mocks.trackStore.value?.tracks[0]?.clips).toEqual(bouncedTrack?.clips);
    });
});
