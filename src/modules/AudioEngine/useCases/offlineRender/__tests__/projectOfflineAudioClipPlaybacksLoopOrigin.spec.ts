import { describe, expect, it } from 'vitest';

import { projectOfflineAudioClipPlaybacks } from '../projectOfflineAudioClipPlaybacks';

/**
 * #4988, first consequence, audio: trimming a looped clip's start must show a
 * different portion of the same loop, not slide the read window. The clip's
 * passes read the loop region the clip was looped with, cyclically, entering
 * at the trim advance's phase — one pass projects as two contiguous playbacks
 * across the region wrap, and nothing past the region end is ever read. A clip
 * without an anchor keeps the pre-anchor read, whose window slid with the
 * trim, exactly as before.
 *
 * Numbers below run at a flat 120 BPM (0.5 s per beat) through identity-ish
 * injectable maps; the source buffer holds 8 beats (4 s), so a bounding by the
 * buffer can never mask the region bound.
 */

const CLIP_BASE = {
    id: 'clip-audio',
    startBeat: 1,
    endBeat: 17,
    loopEnabled: true,
    loopLength: 4,
    stretchMode: 'off' as const,
    stretchRatio: 1,
    gain: 1,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    audioOffsetBeats: 1,
};

function project(input: { loopOriginBeat: number | undefined }): ReturnType<typeof projectOfflineAudioClipPlaybacks> {
    return projectOfflineAudioClipPlaybacks({
        clip: { ...CLIP_BASE, loopOriginBeat: input.loopOriginBeat },
        bufferDurationSeconds: 4,
        regionStartBeat: 0,
        regionStartSec: 0,
        durationSeconds: 40,
        compensationDelay: 0,
        projectBeatToSeconds: (beat) => beat * 0.5,
        resolveTempoAtBeat: () => 120,
    });
}

describe('projectOfflineAudioClipPlaybacks with a loop anchor', () => {
    it('reads the anchored region cyclically: region tail, then wrapped head', () => {
        // Trimmed one beat past the anchor at 0: the pass entering at source
        // beat 1 plays the region tail [1, 4) and then its wrapped head [0, 1).
        const playbacks = project({ loopOriginBeat: 0 });

        expect(playbacks).toHaveLength(8); // 4 passes x 2 segments
        const headTail = playbacks[0]!;
        const headWrap = playbacks[1]!;
        expect(headTail).toMatchObject({ startSec: 0.5, bufferOffsetSec: 0.5, playDuration: 1.5 });
        expect(headWrap).toMatchObject({ startSec: 2.0, bufferOffsetSec: 0, playDuration: 0.5 });
        // The wrap seam is contiguous: the wrapped head starts exactly where
        // the region tail ends.
        expect(headWrap.startSec).toBeCloseTo(headTail.startSec + headTail.playDuration, 9);
    });

    it('never reads past the region end in any pass', () => {
        const playbacks = project({ loopOriginBeat: 0 });
        for (const playback of playbacks) {
            const readEndSec = playback.bufferOffsetSec + playback.playDuration * playback.playbackRate;
            expect(readEndSec).toBeLessThanOrEqual(2 + 1e-9);
        }
    });

    it('repeats the same read every pass', () => {
        const playbacks = project({ loopOriginBeat: 0 });
        const firstTail = playbacks[0]!;
        const firstWrap = playbacks[1]!;
        const secondTail = playbacks[2]!;
        expect(secondTail).toMatchObject({
            startSec: firstTail.startSec + 2,
            bufferOffsetSec: firstTail.bufferOffsetSec,
            playDuration: firstTail.playDuration,
        });
        expect(playbacks[3]).toMatchObject({ bufferOffsetSec: firstWrap.bufferOffsetSec });
    });

    it('reads exactly the pre-anchor window for an anchored clip that was never trimmed', () => {
        // Advance zero: one segment per pass, reading [offset, offset + loop).
        const playbacks = projectOfflineAudioClipPlaybacks({
            clip: { ...CLIP_BASE, startBeat: 1, endBeat: 17, audioOffsetBeats: 0, loopOriginBeat: 1 },
            bufferDurationSeconds: 4,
            regionStartBeat: 0,
            regionStartSec: 0,
            durationSeconds: 40,
            compensationDelay: 0,
            projectBeatToSeconds: (beat) => beat * 0.5,
            resolveTempoAtBeat: () => 120,
        });
        expect(playbacks[0]).toMatchObject({ startSec: 0.5, bufferOffsetSec: 0, playDuration: 2 });
        expect(playbacks).toHaveLength(4);
    });
});

describe('projectOfflineAudioClipPlaybacks without a loop anchor (legacy projects)', () => {
    it('keeps the pre-anchor sliding window exactly', () => {
        // The same trimmed state as the anchored case: offset 1, no anchor.
        // The pass reads [1, 5) linearly — one playback of the full pass, and
        // material past the region end (2 s) is read. This is the behavior a
        // project written before the anchor keeps.
        const playbacks = project({ loopOriginBeat: undefined });
        const first = playbacks[0]!;

        expect(first).toMatchObject({ startSec: 0.5, bufferOffsetSec: 0.5, playDuration: 2 });
        const readEndSec = first.bufferOffsetSec + first.playDuration * first.playbackRate;
        expect(readEndSec).toBeCloseTo(2.5, 9);
    });
});

describe('projectOfflineAudioClipPlaybacks with a stale anchor while the loop is off', () => {
    it('degenerates to the single pre-change read', () => {
        // The clip was looped, trimmed one beat, then unlooped: `setClipLoop`
        // deliberately keeps the anchor at 0, and with the loop off the pass
        // length is the full visual 16 beats. The stale anchor must be inert —
        // the anchored projection would split every pass into region tail and
        // wrapped head around a boundary nothing loops on, replaying the
        // file's head at the tail. One playback, reading the offset.
        const playbacks = projectOfflineAudioClipPlaybacks({
            clip: { ...CLIP_BASE, loopEnabled: false, loopOriginBeat: 0 },
            bufferDurationSeconds: 4,
            regionStartBeat: 0,
            regionStartSec: 0,
            durationSeconds: 40,
            compensationDelay: 0,
            projectBeatToSeconds: (beat) => beat * 0.5,
            resolveTempoAtBeat: () => 120,
        });

        expect(playbacks).toHaveLength(1);
        expect(playbacks[0]).toMatchObject({ startSec: 0.5, bufferOffsetSec: 0.5, playDuration: 3.5 });
    });
});
