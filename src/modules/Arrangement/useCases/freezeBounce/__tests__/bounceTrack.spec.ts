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

type PushUndoEntry = (
    label: string,
    undoFn: () => void,
    redoFn: () => void,
    metadata?: { restoresBufferIds?: string[] }
) => void;

type TestTransportStore = {
    value: { tempo: number } | null;
};

type TestTrackStore = {
    value: TrackStoreState | null;
    set: ReturnType<typeof vi.fn<(state: TrackStoreState) => void>>;
};

/** Only the fields the lane filter reads; the full lane model is Automation's. */
type LaneFixture = {
    id: string;
    trackId: string;
    clipId?: string;
    parameterId: string;
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
        readSecondsAtBeat: vi.fn<(input: { beat: number }) => number>(),
        readBeatAtSamples: vi.fn<(input: { samples: number; sampleRate: number }) => number>(),
        getAutomationLanes: vi.fn<() => LaneFixture[]>(),
        removeAutomationLane: vi.fn<(laneId: string) => void>(),
        restoreAutomationLanes: vi.fn<(lanes: unknown[]) => void>(),
        trackStore,
        transportStore,
    };
});

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationLanes: mocks.getAutomationLanes,
    removeAutomationLane: mocks.removeAutomationLane,
    restoreAutomationLanes: mocks.restoreAutomationLanes,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: mocks.transportStore,
    readSecondsAtBeat: mocks.readSecondsAtBeat,
    readBeatAtSamples: mocks.readBeatAtSamples,
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
        // Flat 120 BPM in both directions: one beat is half a second.
        mocks.readSecondsAtBeat.mockImplementation(({ beat }) => beat * 0.5);
        mocks.readBeatAtSamples.mockImplementation((input) => input.samples / (0.5 * input.sampleRate));
        mocks.getAutomationLanes.mockImplementation(() => []);
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

    describe('auto-tail clip span (#3691)', () => {
        /** Five seconds of captured decay at the harness sample rate. */
        function createDecayBuffer(): AudioBuffer {
            const buffer = createTestAudioBuffer();
            return { ...buffer, length: 5 * 48000, duration: 5 };
        }

        it('spans the bounced clip across the captured decay an auto-tail render holds', async () => {
            const sourceTrack = createAudioTrack({ clips: [createAudioClip({ startBeat: 0, endBeat: 4 })] });
            setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
            mocks.renderTrackOffline.mockResolvedValue(createDecayBuffer());

            await bounceTrack('track-1', {
                includeInserts: true,
                includeSends: false,
                includeAutomation: false,
                normalization: 'off',
                tailHandling: 'auto',
                destination: 'replace',
            });

            // Beats 0-4 are 2 seconds of music; the buffer holds 5 seconds, which
            // is beat 10 at 120 BPM. Writing 4 would leave the decay unplayed.
            expect(mocks.renderTrackOffline).toHaveBeenCalledWith(
                sourceTrack,
                0,
                4,
                expect.objectContaining({ autoTail: true })
            );
            expect(mocks.trackStore.value?.tracks[0]?.clips[0]).toEqual(
                expect.objectContaining({ startBeat: 0, endBeat: 10 })
            );
        });

        it('keeps the musical end when tail handling is off even if the buffer runs longer', async () => {
            const sourceTrack = createAudioTrack({ clips: [createAudioClip({ startBeat: 0, endBeat: 4 })] });
            setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
            mocks.renderTrackOffline.mockResolvedValue(createDecayBuffer());

            await bounceTrack('track-1', {
                includeInserts: true,
                includeSends: false,
                includeAutomation: false,
                normalization: 'off',
                tailHandling: 'off',
                destination: 'replace',
            });

            expect(mocks.trackStore.value?.tracks[0]?.clips[0]).toEqual(
                expect.objectContaining({ startBeat: 0, endBeat: 4 })
            );
        });

        it('keeps the manual tail endpoint instead of deriving one from the buffer', async () => {
            const sourceTrack = createAudioTrack({ clips: [createAudioClip({ startBeat: 0, endBeat: 4 })] });
            setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
            mocks.renderTrackOffline.mockResolvedValue(createDecayBuffer());

            await bounceTrack('track-1', {
                includeInserts: true,
                includeSends: false,
                includeAutomation: false,
                normalization: 'off',
                tailHandling: 'manual',
                destination: 'replace',
            });

            // The 5-second manual tail is already expressed in beats (4 + 10).
            expect(mocks.trackStore.value?.tracks[0]?.clips[0]).toEqual(
                expect.objectContaining({ startBeat: 0, endBeat: 14 })
            );
        });
    });

    describe('committed fader and pan (#3689)', () => {
        function createMixerTrack(): Track {
            return createAudioTrack({ gain: 0.5, pan: -25, clips: [createAudioClip({})] });
        }

        it('commits the baked fader and pan to unity on replace when automation is included', async () => {
            const sourceTrack = createMixerTrack();
            setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
            mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

            await bounceTrack('track-1', {
                includeInserts: true,
                includeSends: false,
                includeAutomation: true,
                normalization: 'off',
                tailHandling: 'off',
                destination: 'replace',
            });

            // The samples already carry the mixer moves; replaying them through
            // the retained 0.5 fader would audition 0.25.
            const replaced = mocks.trackStore.value?.tracks[0];
            expect(replaced?.gain).toBe(1);
            expect(replaced?.pan).toBe(0);
        });

        it('commits the baked fader and pan to unity on the new track', async () => {
            const sourceTrack = createMixerTrack();
            setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
            mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

            await bounceTrack('track-1', {
                includeInserts: true,
                includeSends: false,
                includeAutomation: true,
                normalization: 'off',
                tailHandling: 'off',
                destination: 'new-track',
            });

            const newTrack = mocks.trackStore.value?.tracks[1];
            expect(newTrack?.gain).toBe(1);
            expect(newTrack?.pan).toBe(0);
            // The original keeps its fader: it still plays its own (unbaked) clips.
            expect(mocks.trackStore.value?.tracks[0]?.gain).toBe(0.5);
        });

        it('retains the source fader and pan when the bounce does not include automation', async () => {
            const sourceTrack = createMixerTrack();
            setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
            mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

            await bounceTrack('track-1', {
                includeInserts: true,
                includeSends: false,
                includeAutomation: false,
                normalization: 'off',
                tailHandling: 'off',
                destination: 'replace',
            });

            // Without automation the print is made at a neutral fader, so the
            // destination still owes the track's own values to replay.
            const replaced = mocks.trackStore.value?.tracks[0];
            expect(replaced?.gain).toBe(0.5);
            expect(replaced?.pan).toBe(-25);
        });

        it('keeps the source fader and pan when the caller owns the undo unit', async () => {
            const sourceTrack = createMixerTrack();
            setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
            mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

            // consolidateAllTracks inverts through a track-clip-state restore that
            // does not carry gain/pan; committing there would write a level undo
            // cannot put back.
            await bounceTrack('track-1', {
                includeInserts: true,
                includeSends: false,
                includeAutomation: true,
                normalization: 'off',
                tailHandling: 'off',
                destination: 'replace',
                recordUndoEntry: false,
            });

            const replaced = mocks.trackStore.value?.tracks[0];
            expect(replaced?.gain).toBe(0.5);
            expect(replaced?.pan).toBe(-25);
        });

        it('retires the committed gain/pan lanes, restores them on undo, retires them again on redo', async () => {
            const gainLane: LaneFixture = { id: 'lane-gain', trackId: 'track-1', parameterId: 'gain' };
            const panLane: LaneFixture = { id: 'lane-pan', trackId: 'track-1', parameterId: 'pan' };
            const deviceLane: LaneFixture = { id: 'lane-device', trackId: 'track-1', parameterId: 'drive' };
            const clipLane: LaneFixture = {
                id: 'lane-clip',
                trackId: 'track-1',
                clipId: 'clip-1',
                parameterId: 'gain',
            };
            const otherTrackLane: LaneFixture = { id: 'lane-other', trackId: 'track-2', parameterId: 'gain' };
            mocks.getAutomationLanes.mockImplementation(() => [
                gainLane,
                panLane,
                deviceLane,
                clipLane,
                otherTrackLane,
            ]);
            const sourceTrack = createAudioTrack({ gain: 0.5, clips: [createAudioClip({})] });
            setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
            mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

            await bounceTrack('track-1', {
                includeInserts: true,
                includeSends: false,
                includeAutomation: true,
                normalization: 'off',
                tailHandling: 'off',
                destination: 'replace',
            });

            // Only the target's track-level mixer lanes were baked into the
            // samples; device, clip-scoped and foreign lanes stay.
            expect(mocks.removeAutomationLane.mock.calls.map((call) => call[0])).toEqual(['lane-gain', 'lane-pan']);

            const [, undo, redo] = getFirstUndoEntry();
            undo();
            expect(mocks.restoreAutomationLanes).toHaveBeenCalledWith([gainLane, panLane]);
            redo();
            expect(mocks.removeAutomationLane.mock.calls.map((call) => call[0])).toEqual([
                'lane-gain',
                'lane-pan',
                'lane-gain',
                'lane-pan',
            ]);
        });

        it('retires no automation lanes when the destination is a new track', async () => {
            const gainLane: LaneFixture = { id: 'lane-gain', trackId: 'track-1', parameterId: 'gain' };
            mocks.getAutomationLanes.mockImplementation(() => [gainLane]);
            const sourceTrack = createAudioTrack({ gain: 0.5, clips: [createAudioClip({})] });
            setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
            mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

            await bounceTrack('track-1', {
                includeInserts: true,
                includeSends: false,
                includeAutomation: true,
                normalization: 'off',
                tailHandling: 'off',
                destination: 'new-track',
            });

            // The new track has a fresh id, so the lanes do not follow it and
            // cannot double-apply.
            expect(mocks.removeAutomationLane).not.toHaveBeenCalled();
        });

        it('clears the replaced track sends when the bounce captured the returns', async () => {
            const sourceTrack = createAudioTrack({
                clips: [createAudioClip({})],
                sends: [{ busId: 'return-bus', level: 1, preFader: false }],
            });
            setTrackStoreState({ tracks: [sourceTrack], selectedTrackId: 'track-1' });
            mocks.renderTrackOffline.mockResolvedValue(createTestAudioBuffer());

            await bounceTrack('track-1', {
                includeInserts: false,
                includeSends: true,
                includeAutomation: false,
                normalization: 'off',
                tailHandling: 'off',
                destination: 'replace',
            });

            // The wet is baked into the clip now; the retained send would feed
            // the return a second time.
            expect(mocks.trackStore.value?.tracks[0]?.sends).toEqual([]);
        });
    });
});
