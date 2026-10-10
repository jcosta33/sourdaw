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

describe('projectOfflineAudioClipPlaybacks fade parity on a dead head segment', () => {
    it('carries the drawn fade in on the first playback it emits — the wrapped tail', () => {
        // The two-segment split's parity case: loop 4, start 8/end 20, offset
        // 5, anchor 5 — advance 3, entry 3, region [2, 6) — with a 4-beat
        // buffer (2 s at 120 BPM) and fadeInBeats 4. Each pass's head segment
        // reads from source beat 5 (2.5 s), at or past the buffer's end, so it
        // emits nothing; the pass's first sounding material is its wrapped
        // tail (source [2, 4)). The fade belongs to the first playback that
        // actually emits — the tail — not to the head's index: a playback
        // whose predecessor emitted no sound continues no unbroken sound, so
        // `scheduleOfflineClipSource`'s absence rule does not cover it. The
        // live scheduler already holds this law (the fade anchors at the
        // pass's first sound, `startedSegments[0]`, ramping 0 → 1 over 0.5 s
        // from 4.5 s); emitting `fadeIn: { userEndSec: 6 }` on this playback
        // prints the identical ramp after the shared #2867 clamp
        // (`6 − 4.5 = 1.5 s` held to half the 1 s play duration).
        const playbacks = projectOfflineAudioClipPlaybacks({
            clip: {
                ...CLIP_BASE,
                startBeat: 8,
                endBeat: 20,
                loopLength: 4,
                loopOriginBeat: 5,
                audioOffsetBeats: 5,
                fadeInBeats: 4,
            },
            bufferDurationSeconds: 2,
            regionStartBeat: 0,
            regionStartSec: 0,
            durationSeconds: 40,
            compensationDelay: 0,
            projectBeatToSeconds: (beat) => beat * 0.5,
            resolveTempoAtBeat: () => 120,
        });

        // Three passes; every head segment is dead, so one playback per pass.
        expect(playbacks).toHaveLength(3);
        // The wrapped tail is the first emitted playback and carries the fade.
        expect(playbacks[0]).toMatchObject({
            startSec: 4.5,
            bufferOffsetSec: 1,
            playDuration: 1,
            fadeIn: { userEndSec: 6 },
        });
        // Later passes continue the (now unbroken) sound: no re-fade.
        expect(playbacks[1]!.fadeIn).toBeUndefined();
        expect(playbacks[2]!.fadeIn).toBeUndefined();
        // The last playback still carries the pass's fade out.
        expect(playbacks[2]!.fadeOut).toBeDefined();
    });

    it('keeps the fade on the head segment when the head actually sounds', () => {
        // Head-alive control for the same figures: a 16-beat buffer (8 s)
        // keeps the head's read (source beat 5) inside the material, so the
        // first emitted playback is the head and the fade stays there.
        const playbacks = projectOfflineAudioClipPlaybacks({
            clip: {
                ...CLIP_BASE,
                startBeat: 8,
                endBeat: 20,
                loopLength: 4,
                loopOriginBeat: 5,
                audioOffsetBeats: 5,
                fadeInBeats: 4,
            },
            bufferDurationSeconds: 8,
            regionStartBeat: 0,
            regionStartSec: 0,
            durationSeconds: 40,
            compensationDelay: 0,
            projectBeatToSeconds: (beat) => beat * 0.5,
            resolveTempoAtBeat: () => 120,
        });

        // Both segments per pass: head (source [5, 6)) then tail ([2, 4)).
        expect(playbacks).toHaveLength(6);
        expect(playbacks[0]).toMatchObject({
            startSec: 4,
            bufferOffsetSec: 2.5,
            playDuration: 0.5,
            fadeIn: { userEndSec: 6 },
        });
        // The wrapped tail follows a sounding head: unbroken, no re-fade.
        expect(playbacks[1]!.fadeIn).toBeUndefined();
    });
});

describe('projectOfflineAudioClipPlaybacks split continuity on a stretched looped clip', () => {
    // The split write law (#4988) on the audio arm, measured at the projector:
    // the fragment's offset advances by the media delta the runtimes played
    // over the cut (`timelineSplitDelta * stretch`), so the anchor it carries
    // must shift by `timelineSplitDelta - contentSplitDelta` — only then does
    // the recovered region `offset - advance` survive and the fragment enter
    // on the same source position its source read at the cut. The figures are
    // the measured regression: source [1, 9), offset 1, anchor 0, loop 4,
    // ratio 2, cut at 5 — the fragment's offset lands at 9, its carried
    // anchor at 0 + (4 - 8) = -4. Before the anchor shifted, the fragment
    // entered at source-second 2.5 while the source read 0.5 at the cut —
    // displaced by exactly `4 x (2 - 1)` source beats.
    const STRETCHED_BASE = {
        id: 'clip-audio',
        loopEnabled: true,
        loopLength: 4,
        stretchMode: 'timestretch' as const,
        stretchRatio: 2,
        gain: 1,
        fadeInBeats: 0,
        fadeOutBeats: 0,
    };

    function project(clip: Record<string, unknown>): ReturnType<typeof projectOfflineAudioClipPlaybacks> {
        return projectOfflineAudioClipPlaybacks({
            clip: clip as never,
            bufferDurationSeconds: 40,
            regionStartBeat: 0,
            regionStartSec: 0,
            durationSeconds: 40,
            compensationDelay: 0,
            projectBeatToSeconds: (beat) => beat * 0.5,
            resolveTempoAtBeat: () => 120,
        });
    }

    /** The placement figures continuity reads: where, from where, how long. */
    const placementOf = (playbacks: ReturnType<typeof projectOfflineAudioClipPlaybacks>) =>
        playbacks.map((playback) => ({
            startSec: playback.startSec,
            bufferOffsetSec: playback.bufferOffsetSec,
            playDuration: playback.playDuration,
        }));

    it('enters the fragment on the source position its source read at the cut', () => {
        const source = project({
            ...STRETCHED_BASE,
            startBeat: 1,
            endBeat: 9,
            audioOffsetBeats: 1,
            loopOriginBeat: 0,
        });
        // The source's second pass is the beat span the fragment inherits:
        // two segments, entering at source beat 1 (0.5 s) and wrapping to
        // the region head (0 s).
        expect(placementOf(source)).toEqual([
            { startSec: 0.5, bufferOffsetSec: 0.5, playDuration: 1.5 },
            { startSec: 2, bufferOffsetSec: 0, playDuration: 0.5 },
            { startSec: 2.5, bufferOffsetSec: 0.5, playDuration: 1.5 },
            { startSec: 4, bufferOffsetSec: 0, playDuration: 0.5 },
        ]);

        // The fragment the split writes: start 5, offset 1 + 4 x 2 = 9,
        // anchor 0 + (4 - 8) = -4. Its projection must be the source's own
        // pass over the span it inherited.
        const fragment = project({
            ...STRETCHED_BASE,
            startBeat: 5,
            endBeat: 9,
            audioOffsetBeats: 9,
            loopOriginBeat: -4,
        });
        expect(placementOf(fragment)).toEqual(placementOf(source).slice(2));
        expect(fragment[0]).toMatchObject({ startSec: 2.5, bufferOffsetSec: 0.5, playDuration: 1.5 });
    });

    it('keeps the unstretched split unchanged: the carried anchor cancels exactly', () => {
        // The same clip with stretch off ignores its dormant ratio 2: the
        // split's media delta equals the timeline delta, the anchor shift is
        // zero, and the fragment reads the source's pass verbatim — the
        // behavior every pre-anchor spec pinned, now explicit at the
        // projector.
        const source = project({
            ...STRETCHED_BASE,
            stretchMode: 'off',
            startBeat: 1,
            endBeat: 9,
            audioOffsetBeats: 1,
            loopOriginBeat: 0,
        });
        const fragment = project({
            ...STRETCHED_BASE,
            stretchMode: 'off',
            startBeat: 5,
            endBeat: 9,
            audioOffsetBeats: 5,
            loopOriginBeat: 0,
        });
        expect(placementOf(fragment)).toEqual(placementOf(source).slice(2));
        expect(fragment[0]).toMatchObject({ startSec: 2.5, bufferOffsetSec: 0.5, playDuration: 1.5 });
    });
});
