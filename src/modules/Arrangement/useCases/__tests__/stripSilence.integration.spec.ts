import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';

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

/** clipDurationBeats = 10 over 100 samples -> 0.1 beats/sample; two regions
 *  at samples [0,20) and [60,100) -> segments [beat 0,2) and [beat 6,10). */
function twoRegionChannelData(): Float32Array<ArrayBuffer> {
    const channelData = new Float32Array(100);
    channelData.fill(0.5, 0, 20);
    channelData.fill(0.5, 60, 100);
    return channelData;
}

describe('stripSilence satellite migration (ledger #2108)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const clip = ClipDummy.create({
            id: 'clip-1',
            trackId: 'track-1',
            audioBufferId: 'buf-1',
            startBeat: 0,
            endBeat: 10,
            audioOffsetBeats: 3,
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
    });

    it('splits into segments with an audioOffsetBeats shifted per segment, not inherited verbatim (regression #2108)', () => {
        expect(stripSilence('clip-1')).toBe(true);

        const clips = trackStore.value!.tracks[0]!.clips;
        expect(clips).toHaveLength(2);
        // Target's audioOffsetBeats was 3; the second segment starts 6 beats
        // into the target, so its buffer-read offset must shift by the same
        // 6 beats — the old implementation copied `audioOffsetBeats: 3` onto
        // every segment verbatim, which played the wrong audio region.
        expect(clips[0]).toMatchObject({ startBeat: 0, endBeat: 2, audioOffsetBeats: 3 });
        expect(clips[1]).toMatchObject({ startBeat: 6, endBeat: 10, audioOffsetBeats: 9 });
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
        // First segment starts at the target's own beat 0 -> shift 0.
        expect(getEnvelope(first!.id)).toEqual({
            clipId: first!.id,
            enabled: true,
            points: [
                { id: 'p-early', beatOffset: 1, gainDb: -6 },
                { id: 'p-late', beatOffset: 8, gainDb: -3 },
            ],
        });
        // Second segment starts 6 beats later -> every point shifts back by 6.
        expect(getEnvelope(second!.id)).toEqual({
            clipId: second!.id,
            enabled: true,
            points: [
                { id: 'p-early', beatOffset: -5, gainDb: -6 },
                { id: 'p-late', beatOffset: 2, gainDb: -3 },
            ],
        });
    });

    it('broadcasts the warp state, rebased, to every new segment and clears the target id (regression #2108)', () => {
        setWarpState('clip-1', {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1.2 }],
            stretchMode: 'beats',
            originalTempo: 120,
        });

        expect(stripSilence('clip-1')).toBe(true);

        const clips = trackStore.value!.tracks[0]!.clips;
        const [first, second] = clips;
        expect(warpStates.has('clip-1')).toBe(false);
        expect(warpStates.get(first!.id)).toEqual({
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 1, warpedBeat: 1.2 }],
            stretchMode: 'beats',
            originalTempo: 120,
        });
        expect(warpStates.get(second!.id)).toEqual({
            enabled: true,
            markers: [{ id: 'm1', originalBeat: -5, warpedBeat: -4.8 }],
            stretchMode: 'beats',
            originalTempo: 120,
        });
    });

    it('migrates a clip-scoped automation lane onto the first segment when it fits there (regression #2108)', () => {
        automationStore.set({
            lanes: [
                {
                    id: 'lane-a',
                    trackId: 'track-1',
                    clipId: 'clip-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [{ id: 'point-a', beat: 1, value: 0.5, curve: 'linear', tension: 0.5 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });

        expect(stripSilence('clip-1')).toBe(true);

        const clips = trackStore.value!.tracks[0]!.clips;
        const [first, second] = clips;
        const lanes = automationStore.value!.lanes;
        expect(lanes).toHaveLength(1);
        expect(lanes[0]).toMatchObject({ clipId: first!.id, points: [{ id: 'point-a', beat: 1 }] });
        expect(lanes[0]!.id).not.toBe('lane-a');
        expect(lanes.some((lane) => lane.clipId === second!.id)).toBe(false);
    });

    it('retires a clip-scoped automation lane whose points fall outside the first segment instead of stranding it (regression #2108)', () => {
        automationStore.set({
            lanes: [
                {
                    id: 'lane-b',
                    trackId: 'track-1',
                    clipId: 'clip-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    // Point at beat 8 rebases to 8 - 6 = 2, outside the first
                    // segment's local span [0, 2) — must retire, not migrate
                    // somewhere it cannot represent.
                    points: [{ id: 'point-b', beat: 8, value: 0.5, curve: 'linear', tension: 0.5 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });

        expect(stripSilence('clip-1')).toBe(true);

        expect(automationStore.value!.lanes).toEqual([]);
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
