import { describe, it, expect, beforeEach } from 'vitest';

import { defaultKneadState, kneadStore, type PitchContour } from '#/modules/Knead/stores';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { type Clip } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';
import { replaceClipAudioBuffer } from '../replaceClipAudioBuffer';

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
        trackStore.set({
            tracks: [TrackDummy.create({ clips: [clip] })],
            selectedTrackId: null,
        });
    });

    it('should update audioBufferId on the clip whose id matches', () => {
        replaceClipAudioBuffer('clip-1', 'buf-new');

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
});
