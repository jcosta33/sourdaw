import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultKneadState, kneadStore, type PitchContour } from '#/modules/Knead/stores';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';
import { replaceClipAudioBuffer } from '../replaceClipAudioBuffer';

const mocks = vi.hoisted(() => ({
    resolveEligibleClipWriteTarget: vi.fn(),
}));

vi.mock('../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

const storedContour: PitchContour = {
    points: [{ time_ms: 0, frequency_hz: 220, confidence: 0.9, voiced: true }],
    sample_rate: 48000,
    hop_size: 256,
};

const clip: Clip = {
    id: 'clip-1',
    trackId: 'track-1',
    name: 'A',
    startBeat: 0,
    endBeat: 4,
    type: 'audio',
    audioBufferId: 'buf-old',
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '',
    locked: false,
    muted: false,
};

describe('replaceClipAudioBuffer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            clipId: 'clip-1',
        });
        trackStore.set({
            tracks: [TrackDummy.create({ clips: [clip] })],
            selectedTrackId: null,
        });
    });

    it('should update audioBufferId on the clip whose id matches', () => {
        const didWrite = replaceClipAudioBuffer('clip-1', 'buf-new');

        expect(didWrite).toBe(true);
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioBufferId).toBe('buf-new');
    });

    it('should update audioBufferId when clipId matches the previous audioBufferId', () => {
        replaceClipAudioBuffer('buf-old', 'buf-replaced');

        expect(trackStore.value?.tracks[0]?.clips[0]?.audioBufferId).toBe('buf-replaced');
    });

    it('should leave the store null when the track store is uninitialized', () => {
        trackStore.set(null);
        replaceClipAudioBuffer('clip-1', 'buf-x');

        expect(trackStore.value).toBeNull();
    });

    it('should clear the clip pitch contour because the new source audio invalidates it', () => {
        kneadStore.set({ ...defaultKneadState, contours: { 'clip-1': storedContour } });

        replaceClipAudioBuffer('clip-1', 'buf-new');

        expect(kneadStore.value?.contours['clip-1']).toBeUndefined();
    });

    it('should clear the pitch contour keyed by the real clip id when matched by buffer id', () => {
        kneadStore.set({ ...defaultKneadState, contours: { 'clip-1': storedContour } });

        replaceClipAudioBuffer('buf-old', 'buf-replaced');

        expect(kneadStore.value?.contours['clip-1']).toBeUndefined();
    });

    it('returns false without publishing when no clip matches either lookup key', () => {
        const before = trackStore.value;

        const didWrite = replaceClipAudioBuffer('missing', 'buf-new');

        expect(didWrite).toBe(false);
        expect(trackStore.value).toBe(before);
    });

    it('publishes one valid multi-match replacement before clearing both contours', () => {
        const secondClip: Clip = {
            ...clip,
            id: 'clip-2',
            trackId: 'track-2',
        };
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'track-1', clips: [clip] }),
                TrackDummy.create({ id: 'track-2', clips: [secondClip] }),
            ],
            selectedTrackId: null,
        });
        kneadStore.set({
            ...defaultKneadState,
            contours: { 'clip-1': storedContour, 'clip-2': storedContour },
        });
        mocks.resolveEligibleClipWriteTarget.mockImplementation(({ clipId }: { clipId: string }) => ({
            status: 'eligible',
            trackId: clipId === 'clip-1' ? 'track-1' : 'track-2',
            clipId,
        }));
        const setTrackState = vi.spyOn(trackStore, 'set');

        const didWrite = replaceClipAudioBuffer('buf-old', 'buf-new');

        expect(didWrite).toBe(true);
        expect(setTrackState).toHaveBeenCalledTimes(1);
        expect(trackStore.value?.tracks.map((track) => track.clips[0]?.audioBufferId)).toEqual(['buf-new', 'buf-new']);
        expect(kneadStore.value?.contours).toEqual({});
        setTrackState.mockRestore();
    });

    it('atomically rejects a multi-match replacement when any matched owner is ineligible', () => {
        const secondClip: Clip = {
            ...clip,
            id: 'clip-2',
            trackId: 'track-2',
        };
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'track-1', clips: [clip] }),
                TrackDummy.create({ id: 'track-2', clips: [secondClip] }),
            ],
            selectedTrackId: null,
        });
        kneadStore.set({
            ...defaultKneadState,
            contours: { 'clip-1': storedContour, 'clip-2': storedContour },
        });
        mocks.resolveEligibleClipWriteTarget.mockImplementation(({ clipId }: { clipId: string }) => {
            if (clipId === 'clip-1') {
                return { status: 'eligible', trackId: 'track-1', clipId };
            }
            return { status: 'ineligible' };
        });
        const before = structuredClone(trackStore.value);

        const didWrite = replaceClipAudioBuffer('buf-old', 'buf-new');

        expect(didWrite).toBe(false);
        expect(trackStore.value).toEqual(before);
        expect(kneadStore.value?.contours).toEqual({
            'clip-1': storedContour,
            'clip-2': storedContour,
        });
    });

    it('rejects the whole replacement before publication or contour clearing when one owner is ineligible', () => {
        kneadStore.set({ ...defaultKneadState, contours: { 'clip-1': storedContour } });
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

        const didWrite = replaceClipAudioBuffer('clip-1', 'buf-new');

        expect(didWrite).toBe(false);
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioBufferId).toBe('buf-old');
        expect(kneadStore.value?.contours['clip-1']).toEqual(storedContour);
    });

    it('rejects an empty buffer id without touching the store', () => {
        const before = trackStore.value;

        const didWrite = replaceClipAudioBuffer('clip-1', '');

        expect(didWrite).toBe(false);
        expect(trackStore.value).toBe(before);
    });

    it('rejects when the matched clip is not an audio clip', () => {
        // A midi clip sharing the lookup key cannot receive a buffer swap.
        const midiClip: Clip = { ...clip, id: 'clip-midi', type: 'midi' };
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-1', clips: [midiClip] })],
            selectedTrackId: null,
        });
        const before = trackStore.value;

        const didWrite = replaceClipAudioBuffer('clip-midi', 'buf-new');

        expect(didWrite).toBe(false);
        expect(trackStore.value).toBe(before);
    });

    it('leaves non-matching sibling clips untouched while swapping the matched one', () => {
        // Two clips on one track: the map's "not in set" branch must return the
        // sibling by reference while patching only the matched clip.
        const sibling: Clip = { ...clip, id: 'clip-other', audioBufferId: 'buf-other' };
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-1', clips: [sibling, clip] })],
            selectedTrackId: null,
        });

        const didWrite = replaceClipAudioBuffer('clip-1', 'buf-new');

        expect(didWrite).toBe(true);
        const clips = trackStore.value?.tracks[0]?.clips;
        expect(clips?.[0]?.audioBufferId).toBe('buf-other');
        expect(clips?.[1]?.audioBufferId).toBe('buf-new');
    });
});
