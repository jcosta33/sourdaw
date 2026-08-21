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

        const didWrite = await bounceTrack('track-1', options);

        const expectedBufferId = 'bounce-track-1-1234567890';
        expect(mocks.renderTrackOffline).toHaveBeenCalledWith(sourceTrack, 2, 8, {
            onScheduled: expect.any(Function),
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
        expect(didWrite).toBe(true);
    });

    it('files no callback undo entry when the caller owns the undo unit, but still writes the bounce', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const sourceTrack = createAudioTrack({ clips: [createAudioClip({ id: 'clip-source' })] });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);

        const didWrite = await bounceTrack('track-1', {
            includeInserts: true,
            includeSends: false,
            includeAutomation: true,
            normalization: 'protection',
            tailHandling: 'off',
            destination: 'replace',
            recordUndoEntry: false,
        });

        // The suppression is only about history: the project write still has to land, or
        // the caller's own inverse would be guarding a post-state that never happened.
        expect(didWrite).toBe(true);
        expect(mocks.trackStore.value?.tracks[0]?.clips[0]?.audioBufferId).toBe('bounce-track-1-1234567890');
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('rejects dormant VCA bounce before render, cache, IDs, history, or project work', async () => {
        const sourceTrack = createAudioTrack();
        Object.defineProperty(sourceTrack, 'kind', { value: 'vca' });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });

        const didWrite = await bounceTrack('track-1', {
            includeInserts: true,
            includeSends: true,
            includeAutomation: true,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'replace',
        });

        expect(mocks.renderTrackOffline).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(crypto.randomUUID).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(mocks.trackStore.set).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('returns false when the track store has not loaded', async () => {
        mocks.trackStore.value = null;

        const didWrite = await bounceTrack('track-1', {
            includeInserts: false,
            includeSends: false,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'replace',
        });

        expect(didWrite).toBe(false);
        expect(mocks.renderTrackOffline).not.toHaveBeenCalled();
    });

    it('returns false when the track is missing or has no clips', async () => {
        const sourceTrack = createAudioTrack({ clips: [] });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });

        const didWrite = await bounceTrack('track-1', {
            includeInserts: false,
            includeSends: false,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'replace',
        });

        expect(didWrite).toBe(false);
        expect(mocks.renderTrackOffline).not.toHaveBeenCalled();
    });

    it('returns false when offline render produces no buffer', async () => {
        const sourceTrack = createAudioTrack();
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(null);

        const didWrite = await bounceTrack('track-1', {
            includeInserts: false,
            includeSends: false,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'replace',
        });

        expect(didWrite).toBe(false);
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.trackStore.set).not.toHaveBeenCalled();
    });

    it('adds a fixed 5-second tail when tailHandling is manual', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const sourceClip = createAudioClip({ startBeat: 0, endBeat: 4 });
        const sourceTrack = createAudioTrack({ clips: [sourceClip] });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);
        mocks.transportStore.value = { tempo: 120 };

        await bounceTrack('track-1', {
            includeInserts: true,
            includeSends: false,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'manual',
            destination: 'replace',
        });

        // 5s at 120bpm = 10 beats → endBeat 4 + 10 = 14
        expect(mocks.renderTrackOffline).toHaveBeenCalledWith(sourceTrack, 0, 14, expect.objectContaining({}));
    });

    it('falls back to 120bpm for the tail when transport has no tempo', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const sourceTrack = createAudioTrack({ clips: [createAudioClip({ startBeat: 0, endBeat: 4 })] });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);
        mocks.transportStore.value = null;

        await bounceTrack('track-1', {
            includeInserts: true,
            includeSends: false,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'manual',
            destination: 'replace',
        });

        // null tempo → 120bpm → same 10-beat tail
        expect(mocks.renderTrackOffline).toHaveBeenCalledWith(sourceTrack, 0, 14, expect.objectContaining({}));
    });

    it('creates a new audio track with the bounced clip when destination is new-track', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const sourceClip = createAudioClip({ startBeat: 0, endBeat: 4 });
        const sourceTrack = createAudioTrack({
            clips: [sourceClip],
            devices: [{ id: 'd1', name: 'EQ', type: 'eq', bypassed: false, parameterValues: {} }],
            sends: [{ busId: 'bus', level: 1, preFader: false }],
        });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);

        const didWrite = await bounceTrack('track-1', {
            includeInserts: false,
            includeSends: true,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'new-track',
        });

        expect(didWrite).toBe(true);
        // two tracks now: original + new bounced track inserted right after source
        const tracks = mocks.trackStore.value?.tracks ?? [];
        expect(tracks).toHaveLength(2);
        const newTrack = tracks[1];
        expect(newTrack?.kind).toBe('audio');
        expect(newTrack?.name).toBe('Guitar (bounce)');
        expect(newTrack?.clips[0]?.audioBufferId).toBe('bounce-track-1-1234567890');
        // includeInserts false → keep devices; includeSends true → clear sends
        expect(newTrack?.devices).toEqual(sourceTrack.devices);
        expect(newTrack?.sends).toEqual([]);
        expect(newTrack?.alternatives).toHaveLength(1);
    });

    it('preserves devices and sends on the new track when neither inserts nor sends are included', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const devices = [{ id: 'd1', name: 'EQ', type: 'eq', bypassed: false, parameterValues: {} }];
        const sends = [{ busId: 'bus', level: 1, preFader: false }];
        const sourceTrack = createAudioTrack({ clips: [createAudioClip({})], devices, sends });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);

        await bounceTrack('track-1', {
            includeInserts: false,
            includeSends: false,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'new-track',
        });

        const newTrack = mocks.trackStore.value?.tracks[1];
        expect(newTrack?.devices).toEqual(devices);
        expect(newTrack?.sends).toEqual(sends);
    });

    it('keeps the original devices on replace when inserts are not included', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const devices = [{ id: 'd1', name: 'EQ', type: 'eq', bypassed: false, parameterValues: {} }];
        const sourceTrack = createAudioTrack({ clips: [createAudioClip({})], devices });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);

        await bounceTrack('track-1', {
            includeInserts: false,
            includeSends: false,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'replace',
        });

        const replaced = mocks.trackStore.value?.tracks[0];
        expect(replaced?.devices).toEqual(devices);
    });

    it('leaves sibling tracks untouched when replacing only the target track', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const targetClip = createAudioClip({ id: 'clip-target', startBeat: 0, endBeat: 4 });
        const targetTrack = createAudioTrack({ id: 'track-1', clips: [targetClip] });
        const siblingTrack = createAudioTrack({
            id: 'track-2',
            clips: [createAudioClip({ id: 'clip-sibling', trackId: 'track-2' })],
        });
        setTrackStoreState({ tracks: [targetTrack, siblingTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);

        await bounceTrack('track-1', {
            includeInserts: true,
            includeSends: false,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'replace',
        });

        const tracks = mocks.trackStore.value?.tracks ?? [];
        expect(tracks).toHaveLength(2);
        // Sibling is passed through by identity — same reference, untouched.
        expect(tracks[1]).toBe(siblingTrack);
    });

    it('clears inserts on the new track when includeInserts is true', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const devices = [{ id: 'd1', name: 'EQ', type: 'eq', bypassed: false, parameterValues: {} }];
        const sourceTrack = createAudioTrack({ clips: [createAudioClip({})], devices });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);

        await bounceTrack('track-1', {
            includeInserts: true,
            includeSends: false,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'new-track',
        });

        const newTrack = mocks.trackStore.value?.tracks[1];
        expect(newTrack?.devices).toEqual([]);
    });

    it('returns false when the store is cleared between render and commit', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const sourceTrack = createAudioTrack();
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);
        // Simulate the store being torn down during the async render gap
        mocks.renderTrackOffline.mockImplementation(async () => {
            mocks.trackStore.value = null;
            return renderedBuffer;
        });

        const didWrite = await bounceTrack('track-1', {
            includeInserts: false,
            includeSends: false,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'replace',
        });

        expect(didWrite).toBe(false);
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('renders the union span of multiple clips and applies it to a single bounced clip', async () => {
        const renderedBuffer = createTestAudioBuffer();
        // Order the clips so the first sets both the min start and max end; the
        // second clip establishes neither a new min nor a new max.
        const wide = createAudioClip({ id: 'wide', startBeat: 0, endBeat: 10 });
        const inner = createAudioClip({ id: 'inner', startBeat: 4, endBeat: 6 });
        const sourceTrack = createAudioTrack({ clips: [wide, inner] });
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);

        await bounceTrack('track-1', {
            includeInserts: false,
            includeSends: false,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'replace',
        });

        // The bounce spans the union [0, 10] of both clips.
        expect(mocks.renderTrackOffline).toHaveBeenCalledWith(sourceTrack, 0, 10, expect.any(Object));
        const bouncedTrack = mocks.trackStore.value?.tracks[0];
        expect(bouncedTrack?.clips[0]).toEqual(expect.objectContaining({ startBeat: 0, endBeat: 10 }));
    });

    it('undo is a no-op when the store is cleared before the undo runs', async () => {
        const renderedBuffer = createTestAudioBuffer();
        const sourceTrack = createAudioTrack();
        setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
        mocks.renderTrackOffline.mockResolvedValue(renderedBuffer);

        await bounceTrack('track-1', {
            includeInserts: false,
            includeSends: false,
            includeAutomation: false,
            normalization: 'off',
            tailHandling: 'off',
            destination: 'replace',
        });

        const [, undo, redo] = getFirstUndoEntry();
        // Tear the store down so both undo and redo hit their guard and become no-ops.
        mocks.trackStore.value = null;
        expect(() => undo()).not.toThrow();
        expect(() => redo()).not.toThrow();
        expect(mocks.trackStore.value).toBeNull();
    });
});
