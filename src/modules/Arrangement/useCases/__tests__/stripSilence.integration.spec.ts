import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '../../stores/gainEnvelopeStore';
import { trackStore } from '../../stores/trackStore';
import { setWarpState, warpStates } from '../../stores/warpStates';
import { stripSilence } from '../stripSilence';

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

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

/**
 * At 600 BPM a beat is 0.1s, so the 100 Hz fixture buffer runs at exactly 10
 * samples per beat. The buffer is 20 beats long; the clip under test spans
 * timeline [16, 26] with `audioOffsetBeats` 3, so it plays buffer beats
 * [3, 13) and nothing else.
 */
const FIXTURE_TEMPO = 600;
const SAMPLES_PER_BEAT = 10;
const CLIP_START_BEAT = 16;
const CLIP_AUDIO_OFFSET_BEATS = 3;

/**
 * Sound at buffer beats [0,2), [4,6) and [10,13). The first block is BEFORE
 * the played window and must never be seen. The other two played at timeline
 * [17,19) and [23,26), which is exactly where their segments must land.
 */
function twoRegionChannelData(): Float32Array<ArrayBuffer> {
    const channelData = new Float32Array(20 * SAMPLES_PER_BEAT);
    channelData.fill(0.5, 0 * SAMPLES_PER_BEAT, 2 * SAMPLES_PER_BEAT);
    channelData.fill(0.5, 4 * SAMPLES_PER_BEAT, 6 * SAMPLES_PER_BEAT);
    channelData.fill(0.5, 10 * SAMPLES_PER_BEAT, 13 * SAMPLES_PER_BEAT);
    return channelData;
}

type AutomationLanePoints = NonNullable<typeof automationStore.value>['lanes'][number]['points'];

/** One clip-scoped lane on the target clip, with the given absolute-beat points. */
function setClipAutomationLane(laneId: string, points: AutomationLanePoints): void {
    automationStore.set({
        lanes: [
            {
                id: laneId,
                trackId: 'track-1',
                clipId: 'clip-1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points,
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
                minValue: 0,
                maxValue: 1,
            },
        ],
    });
}

describe('stripSilence satellite migration (ledger #2108)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transportStore.set({ ...defaultTransportState, tempo: FIXTURE_TEMPO });
        const clip = ClipDummy.create({
            id: 'clip-1',
            trackId: 'track-1',
            audioBufferId: 'buf-1',
            startBeat: CLIP_START_BEAT,
            endBeat: CLIP_START_BEAT + 10,
            audioOffsetBeats: CLIP_AUDIO_OFFSET_BEATS,
        });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: 'track-1', ghostClips: [] });
        mocks.getCachedAudioBuffer.mockReturnValue(createTestAudioBuffer(twoRegionChannelData()));
        automationStore.set({ lanes: [] });
        __resetGainEnvelopesForTest();
        warpStates.clear();
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        __resetGainEnvelopesForTest();
        warpStates.clear();
        transportStore.set(defaultTransportState);
    });

    it('places every segment on the audio it already played (regression #2108)', () => {
        expect(stripSilence('clip-1')).toBe(true);

        const clips = trackStore.value!.tracks[0]!.clips;
        expect(clips).toHaveLength(2);
        // Audible-playback equivalence: before the strip, timeline beat 17 of
        // this clip played buffer beat 4 and timeline beat 23 played buffer
        // beat 10. Each segment must sit at that timeline position AND read
        // from that same buffer beat.
        expect(clips[0]).toMatchObject({ startBeat: 17, endBeat: 19, audioOffsetBeats: 4 });
        expect(clips[1]).toMatchObject({ startBeat: 23, endBeat: 26, audioOffsetBeats: 10 });
        expect(clips.map((clip) => clip.id)).not.toContain('clip-1');
    });

    it('broadcasts the gain envelope, rebased, to every new segment and clears the target id (regression #2108)', () => {
        setEnvelope('clip-1', {
            clipId: 'clip-1',
            enabled: true,
            points: [
                { id: 'p-early', beatOffset: 1, gainDb: -6 },
                { id: 'p-late', beatOffset: 8, gainDb: -3 },
            ],
        });

        expect(stripSilence('clip-1')).toBe(true);

        const clips = trackStore.value!.tracks[0]!.clips;
        const [first, second] = clips;
        expect(getEnvelope('clip-1')).toBeUndefined();
        // First segment starts 1 beat into the target -> every point shifts
        // back by 1.
        expect(getEnvelope(first!.id)).toEqual({
            clipId: first!.id,
            enabled: true,
            points: [
                { id: 'p-early', beatOffset: 0, gainDb: -6 },
                { id: 'p-late', beatOffset: 7, gainDb: -3 },
            ],
        });
        // Second segment starts 7 beats into the target -> shift back by 7.
        expect(getEnvelope(second!.id)).toEqual({
            clipId: second!.id,
            enabled: true,
            points: [
                { id: 'p-early', beatOffset: -6, gainDb: -6 },
                { id: 'p-late', beatOffset: 1, gainDb: -3 },
            ],
        });
    });

    it('broadcasts the warp state, rebased, to every new segment and clears the target id (regression #2108)', () => {
        setWarpState('clip-1', {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 2, warpedBeat: 3 }],
            stretchMode: 'beats',
            originalTempo: 120,
        });

        expect(stripSilence('clip-1')).toBe(true);

        const clips = trackStore.value!.tracks[0]!.clips;
        const [first, second] = clips;
        expect(warpStates.has('clip-1')).toBe(false);
        expect(warpStates.get(first!.id)).toEqual({
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 2 }],
            stretchMode: 'beats',
            originalTempo: 120,
        });
        expect(warpStates.get(second!.id)).toEqual({
            enabled: true,
            markers: [{ id: 'm1', originalBeat: -5, warpedBeat: -4 }],
            stretchMode: 'beats',
            originalTempo: 120,
        });
    });

    it('re-keys a clip-scoped automation lane to the LATER segment holding its points, verbatim (regression #2108)', () => {
        // Absolute timeline beat 24 sits inside the second segment [23, 26].
        // Points are never rebased: `applyAutomation` evaluates them at the
        // playhead's absolute beat.
        setClipAutomationLane('lane-a', [{ id: 'point-a', beat: 24, value: 0.5, curve: 'linear', tension: 0.5 }]);

        expect(stripSilence('clip-1')).toBe(true);

        const clips = trackStore.value!.tracks[0]!.clips;
        const [first, second] = clips;
        const lanes = automationStore.value!.lanes;
        expect(lanes).toHaveLength(1);
        expect(lanes[0]).toMatchObject({
            clipId: second!.id,
            points: [{ id: 'point-a', beat: 24, value: 0.5 }],
        });
        expect(lanes[0]!.id).not.toBe('lane-a');
        expect(lanes.some((lane) => lane.clipId === first!.id)).toBe(false);
    });

    it('splits one lane across every segment its points reach (regression #2108)', () => {
        setClipAutomationLane('lane-split', [
            { id: 'point-first', beat: 18, value: 0.25, curve: 'linear', tension: 0 },
            // Beat 21 is inside the stripped silence — no surviving clip owns
            // that moment, so this point retires with the audio.
            { id: 'point-gone', beat: 21, value: 0.5, curve: 'linear', tension: 0 },
            { id: 'point-second', beat: 24, value: 0.75, curve: 'linear', tension: 0 },
        ]);

        expect(stripSilence('clip-1')).toBe(true);

        const [first, second] = trackStore.value!.tracks[0]!.clips;
        const lanes = automationStore.value!.lanes;
        expect(lanes).toHaveLength(2);
        expect(lanes.find((lane) => lane.clipId === first!.id)!.points).toEqual([
            { id: 'point-first', beat: 18, value: 0.25, curve: 'linear', tension: 0 },
        ]);
        expect(lanes.find((lane) => lane.clipId === second!.id)!.points).toEqual([
            { id: 'point-second', beat: 24, value: 0.75, curve: 'linear', tension: 0 },
        ]);
    });

    it('retires a clip-scoped automation lane whose points fall in stripped silence instead of stranding it (regression #2108)', () => {
        // Beat 21 is between the two segments — the audio that carried it is
        // gone, so there is no clip window left to evaluate it in.
        setClipAutomationLane('lane-b', [{ id: 'point-b', beat: 21, value: 0.5, curve: 'linear', tension: 0.5 }]);

        expect(stripSilence('clip-1')).toBe(true);

        expect(automationStore.value!.lanes).toEqual([]);
    });

    it('round-trips a populated clip-scoped lane through undo (regression #2108)', async () => {
        const { prepareStripSilence } = await import('../prepareStripSilence');
        const { restoreStripSilenceState } = await import('../restoreStripSilenceState');
        const originalPoints: AutomationLanePoints = [
            { id: 'point-a', beat: 24, value: 0.5, curve: 'linear', tension: 0.5 },
        ];
        setClipAutomationLane('lane-a', originalPoints);

        const plan = prepareStripSilence({ clipId: 'clip-1' });
        expect(plan).not.toBeNull();
        expect(restoreStripSilenceState({ expected: plan!.previous, replacement: plan!.next })).toBe(true);
        expect(automationStore.value!.lanes[0]!.id).not.toBe('lane-a');

        // Undo compares the live lane against `plan.next` by JSON — the only
        // path where that comparison meets a populated lane read back out of
        // the store.
        expect(restoreStripSilenceState({ expected: plan!.next, replacement: plan!.previous })).toBe(true);
        expect(automationStore.value!.lanes).toHaveLength(1);
        expect(automationStore.value!.lanes[0]).toMatchObject({
            id: 'lane-a',
            clipId: 'clip-1',
            points: originalPoints,
        });
    });

    it('round-trips the full satellite transition through undo (regression #2108)', async () => {
        const { prepareStripSilence } = await import('../prepareStripSilence');
        const { restoreStripSilenceState } = await import('../restoreStripSilenceState');
        setEnvelope('clip-1', { clipId: 'clip-1', enabled: true, points: [{ id: 'p1', beatOffset: 1, gainDb: -6 }] });

        const plan = prepareStripSilence({ clipId: 'clip-1' });
        expect(plan).not.toBeNull();
        expect(restoreStripSilenceState({ expected: plan!.previous, replacement: plan!.next })).toBe(true);
        const segmentIds = trackStore.value!.tracks[0]!.clips.map((clip) => clip.id);
        expect(getEnvelope('clip-1')).toBeUndefined();
        expect(segmentIds.some((id) => getEnvelope(id) !== undefined)).toBe(true);

        // Undo: swap expected/replacement.
        expect(restoreStripSilenceState({ expected: plan!.next, replacement: plan!.previous })).toBe(true);
        const restoredClips = trackStore.value!.tracks[0]!.clips;
        expect(restoredClips).toHaveLength(1);
        expect(restoredClips[0]!.id).toBe('clip-1');
        expect(getEnvelope('clip-1')).toEqual({
            clipId: 'clip-1',
            enabled: true,
            points: [{ id: 'p1', beatOffset: 1, gainDb: -6 }],
        });
        for (const segmentId of segmentIds) {
            expect(getEnvelope(segmentId)).toBeUndefined();
        }
    });
});
