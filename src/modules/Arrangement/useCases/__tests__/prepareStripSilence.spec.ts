import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip, type Track } from '../../models/Track';
import { type TrackState } from '../../repositories/track/getTrackState';
import { prepareStripSilence } from '../prepareStripSilence';

const mocks = vi.hoisted(() => ({
    getAutomationLanes: vi.fn<() => unknown[]>(() => []),
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => AudioBuffer | null>(),
    getTrackState: vi.fn<() => TrackState | null>(),
    resolveEligibleClipWriteTarget: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationLanes: mocks.getAutomationLanes,
}));

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

function createTrackWithClips(clips: Clip[]): Track {
    return TrackDummy.create({ id: 'track-1', clips });
}

function createTrackState(track: Track): TrackState {
    return { tracks: [track], selectedTrackId: 'track-1', ghostClips: [] };
}

/**
 * The clip-to-buffer mapping runs through tempo (`audioOffsetBeats` and the
 * clip's span are beats; the buffer is samples), so every fixture pins one.
 * At 600 BPM a beat is 0.1s, which at the fixtures' 100 Hz sample rate is
 * exactly 10 samples per beat — the 1 sample : 0.1 beat scale these buffers
 * are written against.
 */
const FIXTURE_TEMPO = 600;
const SAMPLES_PER_BEAT = 10;

function createTestAudioBuffer(channelData: Float32Array<ArrayBuffer>): AudioBuffer {
    const sampleRate = 100;
    return {
        copyFromChannel: (destination, _channelNumber, startInChannel = 0) => {
            destination.set(channelData.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source, _channelNumber, startInChannel = 0) => {
            channelData.set(source, startInChannel);
        },
        duration: channelData.length / sampleRate,
        getChannelData: () => channelData,
        length: channelData.length,
        numberOfChannels: 1,
        sampleRate,
    };
}

describe('prepareStripSilence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transportStore.set({ ...defaultTransportState, tempo: FIXTURE_TEMPO });
        mocks.getAutomationLanes.mockReturnValue([]);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            clipId: 'clip-1',
        });
    });

    afterEach(() => {
        transportStore.set(defaultTransportState);
    });

    it('returns null when track state is missing', () => {
        mocks.getTrackState.mockReturnValue(null);

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });

    it('returns null when the clip is missing', () => {
        const clip = ClipDummy.create({ id: 'other-clip', audioBufferId: 'buf-1' });
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });

    it('returns null when the clip is not audio', () => {
        const clip = ClipDummy.create({ id: 'clip-1', type: 'midi', audioBufferId: 'buf-1' });
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });

    it('returns null when the audio clip has no buffer id', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: undefined });
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
    });

    it('returns null when the owner cache has no buffer', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1' });
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
    });

    it('returns null when the audio has only one sound region', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1' });
        const channelData = new Float32Array(100).fill(0.5);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
    });

    it('splits multi-region audio into a before/after snapshot', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1', startBeat: 0, endBeat: 10 });
        const track = createTrackWithClips([clip]);
        const channelData = new Float32Array(100);
        channelData.fill(0.5, 0, 20);
        channelData.fill(0.5, 60, 100);
        mocks.getTrackState.mockReturnValue(createTrackState(track));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1' });

        expect(plan).not.toBeNull();
        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1' });
        expect(plan!.next.clips).toEqual([
            expect.objectContaining({ audioBufferId: 'buf-1', endBeat: 2, startBeat: 0 }),
            expect.objectContaining({ audioBufferId: 'buf-1', endBeat: 10, startBeat: 6 }),
        ]);
        expect(plan!.next.clips.map((clip) => clip.id)).not.toContain('clip-1');
        expect(plan!.previous.clips).toEqual([expect.objectContaining({ id: 'clip-1' })]);
        expect(plan!.newClipIds).toHaveLength(2);
    });

    it('merges adjacent regions whose silence gap is below minSilenceBeats', () => {
        // clipDurationBeats = 10 over 100 samples -> 0.1 beats/sample.
        // Regions: loud 0-19, 22-41 (gap of 2 samples = 0.2 beats < 0.5 merges),
        //          then a large 40-sample gap (4 beats, not merged) to loud 82-99.
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1', startBeat: 0, endBeat: 10 });
        const channelData = new Float32Array(100);
        channelData.fill(0.5, 0, 20);
        channelData.fill(0.5, 22, 42);
        channelData.fill(0.5, 82, 100);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1' });

        expect(plan).not.toBeNull();
        // 3 detected regions, but the first two (gap 0.2 beats) merged -> 2 clips.
        expect(plan!.next.clips).toHaveLength(2);
    });

    it('returns null when every silence gap is below minSilenceBeats (all regions merge into one)', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1', startBeat: 0, endBeat: 10 });
        const channelData = new Float32Array(100);
        channelData.fill(0.5, 0, 20);
        channelData.fill(0.5, 22, 42);
        channelData.fill(0.5, 45, 65);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
    });

    it('rejects an ineligible owner before buffer scanning or UUID allocation', () => {
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1' });
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        expect(mocks.getCachedAudioBuffer).not.toHaveBeenCalled();
        expect(randomUuid).not.toHaveBeenCalled();
    });

    it('derives the peak-detection window from the buffer sample rate, not a fixed sample count (regression #2108)', () => {
        // At sampleRate 100 the window is floor(100 * 0.01) = 1 sample, so two
        // narrow blips 45 samples apart must register as two regions. A
        // window hardcoded to the buffer's own length (100) would run only
        // one peak-detection pass over the whole buffer and see one region.
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buf-1', startBeat: 0, endBeat: 10 });
        const channelData = new Float32Array(100);
        channelData.fill(0.5, 0, 5);
        channelData.fill(0.5, 50, 55);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1', minDuration: 0 });

        expect(plan).not.toBeNull();
        expect(plan!.next.clips).toHaveLength(2);
    });

    describe('a start-trimmed clip (audioOffsetBeats > 0)', () => {
        // Buffer: 200 samples @ 100 Hz = 20 buffer beats at 10 samples/beat.
        // Clip [16, 26] with audioOffsetBeats 3 plays buffer beats [3, 13) —
        // samples [30, 130). Sound sits at buffer beats [0,2) (BEFORE the
        // played window: the clip never reaches it), [4,6) and [10,13).
        function trimmedClipChannelData(): Float32Array<ArrayBuffer> {
            const channelData = new Float32Array(20 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 0 * SAMPLES_PER_BEAT, 2 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 4 * SAMPLES_PER_BEAT, 6 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 10 * SAMPLES_PER_BEAT, 13 * SAMPLES_PER_BEAT);
            return channelData;
        }

        function createTrimmedClip(): Clip {
            return ClipDummy.create({
                id: 'clip-1',
                audioBufferId: 'buf-1',
                startBeat: 16,
                endBeat: 26,
                audioOffsetBeats: 3,
            });
        }

        it('scans only the played window and keeps each segment on the audio it already played (regression #2108)', () => {
            mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([createTrimmedClip()])));
            mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(trimmedClipChannelData()));

            const plan = prepareStripSilence({ clipId: 'clip-1' });

            expect(plan).not.toBeNull();
            // Sound at buffer beats [4,6) played at timeline [17,19); sound at
            // [10,13) played at [23,26). Each segment must sit exactly there
            // AND read from exactly that buffer beat — audible-playback
            // equivalence. Scanning the whole buffer instead would have found
            // a third region at buffer beats [0,2) that the clip never plays.
            expect(plan!.next.clips).toEqual([
                expect.objectContaining({ startBeat: 17, endBeat: 19, audioOffsetBeats: 4 }),
                expect.objectContaining({ startBeat: 23, endBeat: 26, audioOffsetBeats: 10 }),
            ]);
        });

        it('re-keys a clip-scoped automation lane to the LATER segment that contains its points, verbatim (regression #2108)', () => {
            mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([createTrimmedClip()])));
            mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(trimmedClipChannelData()));
            // Absolute beat 24 lives inside the SECOND segment [23, 26]. A
            // first-segment-only migration retires it; a rebasing one moves it
            // off the audio it was drawn against.
            mocks.getAutomationLanes.mockReturnValue([
                {
                    id: 'lane-a',
                    trackId: 'track-1',
                    clipId: 'clip-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ id: 'point-a', beat: 24, value: 0.5, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ]);

            const plan = prepareStripSilence({ clipId: 'clip-1' });

            expect(plan).not.toBeNull();
            const [, second] = plan!.next.clips;
            expect(plan!.next.clipAutomationLanes).toEqual([
                expect.objectContaining({
                    clipId: second!.id,
                    parameterId: 'gain',
                    points: [{ id: 'point-a', beat: 24, value: 0.5, curve: 'linear', tension: 0 }],
                }),
            ]);
            expect(plan!.next.clipAutomationLanes[0]!.id).not.toBe('lane-a');
        });

        it('returns null when the clip starts past the end of its buffer', () => {
            const clip = ClipDummy.create({
                id: 'clip-1',
                audioBufferId: 'buf-1',
                startBeat: 0,
                endBeat: 10,
                audioOffsetBeats: 25,
            });
            mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
            mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(trimmedClipChannelData()));

            expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        });
    });
});
