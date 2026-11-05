import { describe, expect, it } from 'vitest';

import { type TempoTimeline } from '../../../models/TempoTimeline';
import { type Clip } from '../../../models/Track';
import { audioClipSourceEndBeat } from '../audioClipSourceEndBeat';

/** A constant 120 BPM map: two beats a second. */
const timeline: TempoTimeline = {
    secondsAtBeat: (beat) => beat / 2,
    beatAtSeconds: (seconds) => seconds * 2,
    tempoAtBeat: () => 120,
};

function audioClip(fields: Partial<Clip>): Clip {
    return {
        id: 'clip-1',
        trackId: 'track-1',
        name: 'Take',
        type: 'audio',
        audioBufferId: 'buffer-1',
        audioOffsetBeats: 1,
        startBeat: 2,
        endBeat: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...fields,
    };
}

describe('audioClipSourceEndBeat', () => {
    it('reads the beat a non-looping clip runs out of its source on', () => {
        // Entering a 4 s source 1 beat (0.5 s) in leaves 3.5 s, seven beats past beat 2.
        expect(audioClipSourceEndBeat(audioClip({}), 4, timeline)).toBeCloseTo(9, 9);
    });

    it('has no source end for a looping clip, which repeats its source instead of running out', () => {
        expect(audioClipSourceEndBeat(audioClip({ loopEnabled: true }), 4, timeline)).toBeNull();
    });

    it('has no source end for a MIDI clip', () => {
        expect(audioClipSourceEndBeat(audioClip({ type: 'midi' }), 4, timeline)).toBeNull();
    });

    it('has no source end for a source with no positive duration', () => {
        expect(audioClipSourceEndBeat(audioClip({}), 0, timeline)).toBeNull();
    });
});
