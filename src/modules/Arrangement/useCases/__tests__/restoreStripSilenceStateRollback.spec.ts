import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '../../stores/gainEnvelopeStore';
import { trackStore } from '../../stores/trackStore';
import { setWarpState, warpStates } from '../../stores/warpStates';
import { prepareStripSilence } from '../prepareStripSilence';
import { restoreStripSilenceState } from '../restoreStripSilenceState';

// Same shape as `restoreClipGlueState`: the automation transition is the one
// call that can refuse after the satellite migration has already committed,
// and the automation store accepts every well-formed lane, so forcing the
// answer is the only way to observe what the rejection leaves behind.
const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn(),
    applyClipAutomationLaneTransition: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('../clip/applyClipAutomationLaneTransition', () => ({
    applyClipAutomationLaneTransition: mocks.applyClipAutomationLaneTransition,
}));

const FIXTURE_TEMPO = 600;
const SAMPLES_PER_BEAT = 10;
const CLIP_START_BEAT = 16;
const CLIP_AUDIO_OFFSET_BEATS = 3;

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

/** Sound at buffer beats [0,2), [4,6) and [10,13) — two audible regions inside
 *  the played window, so the strip yields two segments. */
function twoRegionChannelData(): Float32Array<ArrayBuffer> {
    const channelData = new Float32Array(20 * SAMPLES_PER_BEAT);
    channelData.fill(0.5, 0 * SAMPLES_PER_BEAT, 2 * SAMPLES_PER_BEAT);
    channelData.fill(0.5, 4 * SAMPLES_PER_BEAT, 6 * SAMPLES_PER_BEAT);
    channelData.fill(0.5, 10 * SAMPLES_PER_BEAT, 13 * SAMPLES_PER_BEAT);
    return channelData;
}

describe('restoreStripSilenceState satellite rollback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.applyClipAutomationLaneTransition.mockReturnValue(true);
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

    it('reverts migrated satellites when the automation transition refuses after they committed', () => {
        const envelope = { clipId: 'clip-1', enabled: true, points: [{ id: 'p1', beatOffset: 1, gainDb: -6 }] };
        const warpState = {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 0, warpedBeat: 0 }],
            stretchMode: 'beats' as const,
            originalTempo: 120,
        };
        setEnvelope('clip-1', envelope);
        setWarpState('clip-1', warpState);

        const plan = prepareStripSilence({ clipId: 'clip-1' });
        expect(plan).not.toBeNull();
        const segmentIds = plan!.next.clipSatellites.map((entry) => entry.clipId).filter((id) => id !== 'clip-1');
        expect(segmentIds.length).toBeGreaterThan(0);

        mocks.applyClipAutomationLaneTransition.mockReturnValue(false);
        expect(restoreStripSilenceState({ expected: plan!.previous, replacement: plan!.next })).toBe(false);

        // `warpStates` is a plain module-level `Map` and is NOT in the
        // Automerge transaction the caller aborts on a rejection, so a
        // migration left standing here survives the abort while the clip it
        // is keyed to does not.
        expect(warpStates.get('clip-1')).toEqual(warpState);
        expect(segmentIds.some((id) => warpStates.has(id))).toBe(false);
        expect(getEnvelope('clip-1')).toEqual(envelope);
        expect(segmentIds.some((id) => getEnvelope(id) !== undefined)).toBe(false);
    });

    it('leaves the plan applicable on a retry after a rejected apply', () => {
        setWarpState('clip-1', {
            enabled: true,
            markers: [{ id: 'm1', originalBeat: 0, warpedBeat: 0 }],
            stretchMode: 'beats',
            originalTempo: 120,
        });
        const plan = prepareStripSilence({ clipId: 'clip-1' });
        expect(plan).not.toBeNull();

        mocks.applyClipAutomationLaneTransition.mockReturnValue(false);
        expect(restoreStripSilenceState({ expected: plan!.previous, replacement: plan!.next })).toBe(false);

        // The satellite stores are back at `previous`, so the same plan still
        // passes its own pre-flight. A stranded migration would fail it.
        mocks.applyClipAutomationLaneTransition.mockReturnValue(true);
        expect(restoreStripSilenceState({ expected: plan!.previous, replacement: plan!.next })).toBe(true);
        expect(warpStates.has('clip-1')).toBe(false);
    });
});
