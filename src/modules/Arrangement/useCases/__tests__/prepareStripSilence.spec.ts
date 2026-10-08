import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip, type Track } from '../../models/Track';
import { type TrackState } from '../../repositories/track/getTrackState';
import { setWarpState, warpStates } from '../../stores/warpStates';
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
        warpStates.clear();
        transportStore.set({ ...defaultTransportState, tempo: FIXTURE_TEMPO });
        tempoMapStore.set({ changes: [] });
        mocks.getAutomationLanes.mockReturnValue([]);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            clipId: 'clip-1',
        });
    });

    afterEach(() => {
        warpStates.clear();
        transportStore.set(defaultTransportState);
        tempoMapStore.set({ changes: [] });
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

    it('emits fragments at the heard samples when canonical zero overrides a stale beat alias', () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buf-1',
            startBeat: 0,
            endBeat: 10,
            audioOffsetBeats: 10,
            audioOffsetSeconds: 0,
        });
        const channelData = new Float32Array(100);
        channelData.fill(0.5, 10, 20);
        channelData.fill(0.5, 40, 50);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1' });

        expect(plan).not.toBeNull();
        expect(plan!.next.clips).toEqual([
            expect.objectContaining({
                startBeat: 1,
                endBeat: 2,
                audioOffsetSeconds: 0.1,
                audioOffsetBeats: 1,
            }),
            expect.objectContaining({
                startBeat: 4,
                endBeat: 5,
                audioOffsetSeconds: 0.4,
                audioOffsetBeats: 4,
            }),
        ]);
    });

    it('keeps the first sounding region when canonical entry falls inside a sample', () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buf-1',
            startBeat: 0,
            endBeat: 10,
            audioOffsetBeats: 9,
            audioOffsetSeconds: 0.105,
        });
        const channelData = new Float32Array(100);
        channelData.fill(0.5, 10, 20);
        channelData.fill(0.5, 40, 50);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1' });

        expect(plan?.next.clips).toHaveLength(2);
        expect(plan!.next.clips[0]).toEqual(
            expect.objectContaining({ startBeat: 0, audioOffsetSeconds: 0.105, audioOffsetBeats: 1.05 })
        );
        expect(plan!.next.clips[0]!.endBeat).toBeCloseTo(0.95, 10);
        expect(plan!.next.clips[1]!.startBeat).toBeCloseTo(2.95, 10);
        expect(plan!.next.clips[1]!.audioOffsetSeconds).toBe(0.4);
    });

    it('places detected source regions through an interior tempo marker', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buf-1',
            startBeat: 0,
            endBeat: 8,
            audioOffsetSeconds: 0,
            audioOffsetBeats: 3,
        });
        const channelData = new Float32Array(700);
        channelData.fill(0.5, 100, 120);
        channelData.fill(0.5, 400, 420);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1' });

        expect(plan?.next.clips).toHaveLength(2);
        expect(plan!.next.clips[0]!.startBeat).toBeCloseTo(2);
        expect(plan!.next.clips[0]!.audioOffsetSeconds).toBeCloseTo(1);
        expect(plan!.next.clips[1]!.startBeat).toBeCloseTo(6);
        expect(plan!.next.clips[1]!.endBeat).toBeCloseTo(6.2);
        expect(plan!.next.clips[1]!.audioOffsetSeconds).toBeCloseTo(4);
    });

    it('begins signed canonical pre-roll at the actual inverse beat before creating fragments', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 2, tempo: 60, curve: 'instant' },
            ],
        });
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buf-1',
            startBeat: 0,
            endBeat: 8,
            audioOffsetBeats: 8,
            audioOffsetSeconds: -2,
        });
        const channelData = new Float32Array(300);
        channelData.fill(0.5, 0, 20);
        channelData.fill(0.5, 150, 170);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1' });

        expect(plan?.next.clips).toHaveLength(2);
        expect(plan!.next.clips[0]).toEqual(
            expect.objectContaining({ startBeat: 3, audioOffsetSeconds: 0, audioOffsetBeats: 0 })
        );
        expect(plan!.next.clips[1]).toEqual(
            expect.objectContaining({ startBeat: 4.5, audioOffsetSeconds: 1.5, audioOffsetBeats: 1.5 })
        );
    });

    it('repeats only actually heard source regions as nonlooping fragments across a tempo seam', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buf-1',
            startBeat: 0,
            endBeat: 8,
            audioOffsetSeconds: 0,
            loopEnabled: true,
            loopLength: 4,
        });
        const channelData = new Float32Array(500);
        channelData.fill(0.5, 50, 60);
        channelData.fill(0.5, 150, 160);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1' });

        expect(plan?.next.clips).toHaveLength(4);
        expect(plan!.next.clips.map((fragment) => fragment.startBeat)).toEqual([1, 3, 4.5, 5.5]);
        expect(plan!.next.clips.map((fragment) => fragment.audioOffsetSeconds)).toEqual([0.5, 1.5, 0.5, 1.5]);
        expect(plan!.next.clips.every((fragment) => fragment.loopEnabled === false)).toBe(true);
        expect(plan!.next.clips.every((fragment) => !Object.hasOwn(fragment, 'loopLength'))).toBe(true);
    });

    it('caps each loop at the buffer end and its final partial iteration', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buf-1',
            startBeat: 0,
            endBeat: 9,
            loopEnabled: true,
            loopLength: 4,
            audioOffsetSeconds: 0,
        });
        const channelData = new Float32Array(150);
        channelData.fill(0.5, 30, 40);
        channelData.fill(0.5, 120, 130);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1' });

        expect(plan?.next.clips).toHaveLength(5);
        expect(plan!.next.clips.map((fragment) => fragment.startBeat)).toEqual([
            expect.closeTo(0.6, 10),
            expect.closeTo(2.4, 10),
            expect.closeTo(4.6, 10),
            expect.closeTo(6.4, 10),
            expect.closeTo(8.6, 10),
        ]);
        expect(plan!.next.clips.map((fragment) => fragment.audioOffsetSeconds)).toEqual([0.3, 1.2, 0.3, 1.2, 0.3]);
        expect(plan!.next.clips.at(-1)!.endBeat).toBeLessThan(9);
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

    it('scans the clip-start-tempo source window and keeps its audible fragments in a flat region', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [{ id: 'slow', beat: 4, tempo: 60, curve: 'instant' }] });
        const clip = ClipDummy.create({
            id: 'clip-1',
            audioBufferId: 'buf-1',
            startBeat: 4,
            endBeat: 6,
            audioOffsetBeats: 0.5,
        });
        const channelData = new Float32Array(200);
        channelData.fill(0.5, 60, 80);
        channelData.fill(0.5, 130, 150);
        mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

        const plan = prepareStripSilence({ clipId: 'clip-1', minDuration: 0.2 });
        expect(plan?.next.clips).toEqual([
            expect.objectContaining({
                startBeat: expect.closeTo(4.1, 10),
                endBeat: expect.closeTo(4.3, 10),
                audioOffsetBeats: 0.6,
            }),
            expect.objectContaining({
                startBeat: expect.closeTo(4.8, 10),
                endBeat: expect.closeTo(5, 10),
                audioOffsetBeats: 1.3,
            }),
        ]);
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
                expect.objectContaining({ startBeat: expect.closeTo(23, 10), endBeat: 26, audioOffsetBeats: 10 }),
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

        it('keeps warp markers on source-content transients instead of shifting them by segment start (regression #2866)', () => {
            mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([createTrimmedClip()])));
            mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(trimmedClipChannelData()));
            // detectTransientsForClip writes beat from the decoded buffer with
            // no clip audioOffsetBeats. These sit on the two audible regions
            // at buffer beats 4 and 10.
            const markersOnTransients = [
                { id: 'transient-4', originalBeat: 4, warpedBeat: 4 },
                { id: 'transient-10', originalBeat: 10, warpedBeat: 10 },
            ];
            setWarpState('clip-1', {
                enabled: true,
                markers: markersOnTransients,
                stretchMode: 'wsola',
                originalTempo: 120,
            });

            const plan = prepareStripSilence({ clipId: 'clip-1' });

            expect(plan).not.toBeNull();
            // First segment shift would be 1 (startBeat 17), second 7 (startBeat 23).
            expect(plan!.next.clips).toEqual([
                expect.objectContaining({ startBeat: 17, endBeat: 19, audioOffsetBeats: 4 }),
                expect.objectContaining({ startBeat: expect.closeTo(23, 10), endBeat: 26, audioOffsetBeats: 10 }),
            ]);
            const segmentSatellites = plan!.next.clipSatellites.filter((entry) => entry.clipId !== 'clip-1');
            expect(segmentSatellites).toHaveLength(2);
            for (const entry of segmentSatellites) {
                expect(entry.warpState?.markers).toEqual(markersOnTransients);
            }
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

    describe('a time-stretched clip (regression #4787)', () => {
        // Playback consumes source at the stretch factor per timeline beat
        // (`consumedStretchFactor`, the law `audioWaveformSpan` draws with):
        // a 10-beat clip at ratio 2 plays 20 buffer beats — 200 samples at 10
        // samples per buffer beat. Sound detected at buffer beat B sounded at
        // timeline beat B / ratio, so each segment must sit exactly there and
        // read from exactly the buffer beats it was detected in.
        function stretchedClipChannelData(): Float32Array<ArrayBuffer> {
            const channelData = new Float32Array(20 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 1 * SAMPLES_PER_BEAT, 2 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 4 * SAMPLES_PER_BEAT, 6 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 12 * SAMPLES_PER_BEAT, 14 * SAMPLES_PER_BEAT);
            return channelData;
        }

        it('scans the full consumed span and lands each segment where its audio played (stretch on, ratio 2)', () => {
            const clip = ClipDummy.create({
                id: 'clip-1',
                audioBufferId: 'buf-1',
                startBeat: 0,
                endBeat: 10,
                stretchMode: 'timestretch',
                stretchRatio: 2,
            });
            mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
            mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(stretchedClipChannelData()));

            const plan = prepareStripSilence({ clipId: 'clip-1' });

            expect(plan).not.toBeNull();
            // Sound at buffer beats [1,2), [4,6) and [12,14) played at
            // timeline [0.5,1), [2,3) and [6,7). A window that divides by the
            // ratio instead scans only buffer beats [0,5) and never finds the
            // third region; a mapping that multiplies by the ratio lands a
            // segment four times its distance from the clip start.
            expect(plan!.next.clips).toEqual([
                expect.objectContaining({ startBeat: 0.5, endBeat: 1, audioOffsetBeats: 1 }),
                expect.objectContaining({ startBeat: 2, endBeat: 3, audioOffsetBeats: 4 }),
                expect.objectContaining({ startBeat: 6, endBeat: expect.closeTo(7, 10), audioOffsetBeats: 12 }),
            ]);
        });

        it('merges a silence gap by its timeline-beat length, not its buffer-beat length', () => {
            // Gap of 8 buffer beats-samples = 0.4 timeline beats at ratio 2
            // (0.1 buffer beats per sample / 2), below the default 0.5
            // minDuration, so both regions must merge into one and the plan is
            // null. A beats-per-sample that multiplied by the ratio instead
            // would read the same gap as 1.6 timeline beats and split it.
            const clip = ClipDummy.create({
                id: 'clip-1',
                audioBufferId: 'buf-1',
                startBeat: 0,
                endBeat: 10,
                stretchMode: 'timestretch',
                stretchRatio: 2,
            });
            const channelData = new Float32Array(20 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 1 * SAMPLES_PER_BEAT, 2 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 2.8 * SAMPLES_PER_BEAT, 3.8 * SAMPLES_PER_BEAT);
            mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
            mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

            expect(prepareStripSilence({ clipId: 'clip-1' })).toBeNull();
        });

        it('ignores the stored ratio while stretch is off', () => {
            const clip = ClipDummy.create({
                id: 'clip-1',
                audioBufferId: 'buf-1',
                startBeat: 0,
                endBeat: 10,
                stretchMode: 'off',
                stretchRatio: 2,
            });
            const channelData = new Float32Array(10 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 1 * SAMPLES_PER_BEAT, 2 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 3 * SAMPLES_PER_BEAT, 4.5 * SAMPLES_PER_BEAT);
            mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
            mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(channelData));

            const plan = prepareStripSilence({ clipId: 'clip-1' });

            expect(plan).not.toBeNull();
            // Every runtime plays an off clip at 1x regardless of the stored
            // ratio, so the segments sit where a ratio-1 clip played the
            // sound: timeline [1,2) and [3,4.5).
            expect(plan!.next.clips).toEqual([
                expect.objectContaining({ startBeat: 1, endBeat: 2, audioOffsetBeats: 1 }),
                expect.objectContaining({ startBeat: 3, endBeat: 4.5, audioOffsetBeats: 3 }),
            ]);
        });
    });

    describe('a pre-rolled clip (audioOffsetBeats < 0)', () => {
        // The scheduler and `computeAudioWaveformDrawSpan` agree: a negative
        // offset is a silent pre-roll costing `max(0, -audioOffsetBeats) /
        // ratio` timeline beats, so a 10-beat off clip offset -4 plays buffer
        // beats [0, 6) — material past buffer beat 6 is never heard.
        function preRolledClipChannelData(): Float32Array<ArrayBuffer> {
            const channelData = new Float32Array(20 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 1 * SAMPLES_PER_BEAT, 2 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 8 * SAMPLES_PER_BEAT, 9.5 * SAMPLES_PER_BEAT);
            return channelData;
        }

        it('scans only the audible span a negative offset leaves, never past the clip end', () => {
            const clip = ClipDummy.create({
                id: 'clip-1',
                audioBufferId: 'buf-1',
                startBeat: 0,
                endBeat: 10,
                stretchMode: 'off',
                audioOffsetBeats: -4,
            });
            mocks.getTrackState.mockReturnValue(createTrackState(createTrackWithClips([clip])));
            mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(preRolledClipChannelData()));

            const plan = prepareStripSilence({ clipId: 'clip-1' });

            // Buffer beats [0, 6) hold one audible region ([1, 2)); the sound
            // at [8, 9.5) sits past the audible span and must produce no
            // segment — an unbounded window splits it into a phantom clip at
            // timeline [12, 13.5), past the clip's endBeat 10.
            expect(plan).toBeNull();
        });
    });
});
