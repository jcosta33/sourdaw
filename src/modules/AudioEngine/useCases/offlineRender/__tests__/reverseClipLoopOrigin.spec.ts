import { describe, expect, it } from 'vitest';

import {
    type OfflineProjectableAudioClip,
    projectOfflineAudioClipPlaybacks,
} from '../projectOfflineAudioClipPlaybacks';

/**
 * #4988, reverse×trim×loop: a reversed buffer is a fresh media basis whose
 * window head is the mirrored visible window (`S − offset − consumed`), and
 * `reverseClip` restamps the loop anchor at the clip's own start — advance
 * zero — so the loop window opens at that head. The fixtures below are the
 * published figures the writer spec pins (`reverseClip.spec.ts`: offset
 * `S − offset − consumed`, anchor restamped to the start); this spec pins the
 * reader half, the projector's region law `audioOffsetBeats − (startBeat −
 * loopOriginBeat)` entering at the advance's phase. Figures are at 60 BPM, so
 * one beat is one second of an 8-beat source.
 */

function reversedClip(startBeat: number, endBeat: number, audioOffsetBeats: number, loopOriginBeat?: number) {
    const clip: OfflineProjectableAudioClip = {
        id: 'c1',
        startBeat,
        endBeat,
        loopLength: 4,
        loopEnabled: true,
        gain: 1,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        audioOffsetBeats,
    };
    if (loopOriginBeat !== undefined) {
        clip.loopOriginBeat = loopOriginBeat;
    }
    return clip;
}

function project(clip: OfflineProjectableAudioClip) {
    return projectOfflineAudioClipPlaybacks({
        clip,
        bufferDurationSeconds: 8,
        regionStartBeat: 0,
        regionStartSec: 0,
        durationSeconds: 40,
        compensationDelay: 0,
        projectBeatToSeconds: (beat) => beat,
        resolveTempoAtBeat: () => 60,
    });
}

describe('a reversed looped clip read through the offline projector', () => {
    it('reads the mirrored window from its head, without a wrap seam, after a trimmed reverse', () => {
        // The reviewer probe's shape (#5198): an 8-beat buffer, looped clip L=4
        // trimmed by one beat — start 1, offset 1, anchor 0 pre-reverse; the
        // writer published offset 3 (the mirrored window [3,7)) with the anchor
        // restamped to 1. Carrying the anchor instead derives region [2,6)
        // entering at 1 and wraps mid-pass, as the defect fixture below shows.
        const playbacks = project(reversedClip(1, 5, 3, 1));

        // Advance zero: the whole 4-beat pass reads one contiguous span — the
        // mirrored window from its head — where the carried anchor split the
        // pass into a [3,…) head and a wrap segment at 2. The clip starts at
        // beat 1, so the sound opens at second 1.
        expect(playbacks).toHaveLength(1);
        expect(playbacks[0]!.startSec).toBe(1);
        expect(playbacks[0]!.bufferOffsetSec).toBe(3);
        expect(playbacks[0]!.playDuration).toBe(4);
    });

    it('keeps an untrimmed reverse reading its mirrored window from the head', () => {
        // Untrimmed, the anchor derives advance zero before and after, so the
        // restamp is a no-op on the read — the pre/post agreement the anchor
        // law promises. The clip spans [0,5) with L=4: the mirrored window
        // head is S − 0 − 5 = 3.
        const playbacks = project(reversedClip(0, 5, 3, 0));

        expect(playbacks[0]!.startSec).toBe(0);
        expect(playbacks[0]!.bufferOffsetSec).toBe(3);
        expect(playbacks[0]!.playDuration).toBe(4);
        // The visible 5th beat continues the loop at the window head.
        expect(playbacks[1]!.startSec).toBe(4);
        expect(playbacks[1]!.bufferOffsetSec).toBe(3);
        expect(playbacks[1]!.playDuration).toBe(1);
    });

    it('the carried anchor the writer no longer writes is what wraps the pass mid-window', () => {
        // The defect, kept as the baseline the fixed figures must not revert
        // to: the pre-reverse anchor 0 carried across the basis change derives
        // advance 1 and splits the pass at the wrap.
        const playbacks = project(reversedClip(1, 5, 3, 0));

        expect(playbacks.length).toBeGreaterThan(1);
        expect(playbacks[0]!.bufferOffsetSec).toBe(3);
        expect(playbacks[1]!.bufferOffsetSec).toBe(2);
    });
});
