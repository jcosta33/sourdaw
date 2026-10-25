import { describe, expect, it } from 'vitest';

import {
    CLIP_LOOP_WINDOW_BEAT_TOLERANCE,
    isBeatInClipLoopWindow,
    resolveClipLoopOriginAdvance,
    resolveLoopAnchoredStartBeat,
    resolveLoopedOffsetBeats,
} from '../clipLoopOrigin';

/**
 * The loop-window membership law behind #4988: the window is the half-open
 * region the clip was looped with, carried backwards by the trim advance in
 * the offset-relative coordinate. The issue's example is a 4-beat loop with
 * notes at source 0 and 4.5 — after a start trim by one beat the 4.5 note
 * must stay out of every pass, and the head note must stay in at its wrapped
 * phase. A clip without an anchor admits everything below the loop length,
 * exactly the pre-anchor law — and so does a clip whose stale anchor dates
 * from a past loop enable, because `setClipLoop` keeps the anchor while the
 * loop is off and the readers must treat it as absent there.
 *
 * Boundary reads carry `CLIP_LOOP_WINDOW_BEAT_TOLERANCE` (#5198): the stored
 * note figure (`note.startBeat - midiOffsetBeats`) and the window bounds
 * (`startBeat - loopOriginBeat`) descend from different rounding chains and
 * can disagree by an ulp, so the inclusive floor also admits within tolerance
 * below it and the exclusive ceiling also excludes within tolerance below it.
 */

const ANCHORED_CLIP = { startBeat: 1, loopOriginBeat: 0, loopLengthBeats: 4, loopEnabled: true } as const;
const STALE_ANCHOR_LOOP_OFF_CLIP = { startBeat: 1, loopOriginBeat: 0, loopLengthBeats: 4, loopEnabled: false } as const;

describe('resolveClipLoopOriginAdvance', () => {
    it('measures the trim advance from the anchor', () => {
        expect(resolveClipLoopOriginAdvance(ANCHORED_CLIP)).toBe(1);
    });

    it('advances zero for a clip without an anchor', () => {
        expect(resolveClipLoopOriginAdvance({ startBeat: 7, loopOriginBeat: undefined, loopEnabled: true })).toBe(0);
    });

    it('advances zero for a stale anchor while the loop is off', () => {
        expect(resolveClipLoopOriginAdvance(STALE_ANCHOR_LOOP_OFF_CLIP)).toBe(0);
    });

    it('advances zero for a non-finite anchor — corruption reads as absence (#5198)', () => {
        // A persisted `1e999` decodes as Infinity and can reach clip state
        // through a store updater, which applies no finiteness guard. Left
        // alone, `startBeat - Infinity` derives a NaN window whose segment
        // extents pass every `<= 0` death guard and reach `source.start()` as
        // the RangeError that kills a scheduler tick. The same degradation
        // `normalize_clip` applies to the document wins: the anchor is absent.
        expect(
            resolveClipLoopOriginAdvance({ startBeat: 1, loopOriginBeat: Number.POSITIVE_INFINITY, loopEnabled: true })
        ).toBe(0);
        expect(resolveClipLoopOriginAdvance({ startBeat: 1, loopOriginBeat: Number.NaN, loopEnabled: true })).toBe(0);
        expect(
            resolveClipLoopOriginAdvance({ startBeat: 1, loopOriginBeat: Number.NEGATIVE_INFINITY, loopEnabled: true })
        ).toBe(0);
    });
});

describe('resolveLoopAnchoredStartBeat', () => {
    it('stamps the anchor while the loop is on', () => {
        expect(resolveLoopAnchoredStartBeat(ANCHORED_CLIP)).toBe(0);
    });

    it('stamps the clip start for an absent or stale anchor', () => {
        expect(resolveLoopAnchoredStartBeat({ ...ANCHORED_CLIP, loopOriginBeat: undefined })).toBe(1);
        expect(resolveLoopAnchoredStartBeat(STALE_ANCHOR_LOOP_OFF_CLIP)).toBe(1);
    });

    it('stamps the clip start for a non-finite anchor (#5198)', () => {
        // The occurrence index derives pass starts from this figure; Infinity
        // would stamp occurrence windows measured from Infinity.
        expect(resolveLoopAnchoredStartBeat({ ...ANCHORED_CLIP, loopOriginBeat: Number.POSITIVE_INFINITY })).toBe(1);
    });
});

describe('isBeatInClipLoopWindow', () => {
    it('keeps the loop-region notes in and the note past the region end out across a trim', () => {
        // Offset 1 after a one-beat trim: relative starts are source − 1.
        expect(
            isBeatInClipLoopWindow({ ...ANCHORED_CLIP, relativeBeat: -1 }) // source 0
        ).toBe(true);
        expect(
            isBeatInClipLoopWindow({ ...ANCHORED_CLIP, relativeBeat: 3.5 }) // source 4.5
        ).toBe(false);
    });

    it('keeps the window anchored when the offset wraps past the loop length', () => {
        // Five beats trimmed: the offset wrapped to 1 and #5022 shifted the
        // stored notes down by 4, so the relative starts are source − 5.
        const clip = { startBeat: 5, loopOriginBeat: 0, loopLengthBeats: 4, loopEnabled: true } as const;
        expect(isBeatInClipLoopWindow({ ...clip, relativeBeat: -5 })).toBe(true); // source 0
        expect(isBeatInClipLoopWindow({ ...clip, relativeBeat: -0.5 })).toBe(false); // source 4.5
    });

    it('keeps the lift band above the loop length admitted when the advance is negative', () => {
        // A trim ACROSS the anchor — start 2 under anchor 4 — carries a
        // negative advance (−2) whose window [2, 6) lifts the ceiling above
        // the loop length. A mutation clamping the advance at zero (or
        // grafting the one-sided `relative < loopLength` ceiling onto the
        // anchored branch) keeps every positive-advance fixture green while
        // dropping exactly this band — the head-level catch lived only in
        // the scheduler specs — so the band is named here: the lifted
        // relative 5 admitted, 6 refused, the floor inclusive, below it out.
        const extended = { startBeat: 2, loopOriginBeat: 4, loopLengthBeats: 4, loopEnabled: true } as const;
        expect(isBeatInClipLoopWindow({ ...extended, relativeBeat: 5 })).toBe(true);
        expect(isBeatInClipLoopWindow({ ...extended, relativeBeat: 6 })).toBe(false);
        expect(isBeatInClipLoopWindow({ ...extended, relativeBeat: 2 })).toBe(true);
        expect(isBeatInClipLoopWindow({ ...extended, relativeBeat: 1.5 })).toBe(false);
    });

    it('admits the region head inclusively and refuses the region end exclusively', () => {
        expect(isBeatInClipLoopWindow({ ...ANCHORED_CLIP, relativeBeat: -1 })).toBe(true);
        expect(isBeatInClipLoopWindow({ ...ANCHORED_CLIP, relativeBeat: 3 })).toBe(false);
    });

    it('admits a head note that drifts within tolerance below the floor', () => {
        // #5198's deep-trim chain puts the loop head an ulp strictly below the
        // naive floor; the tolerance is what keeps the downbeat sounding.
        expect(
            isBeatInClipLoopWindow({ ...ANCHORED_CLIP, relativeBeat: -1 - CLIP_LOOP_WINDOW_BEAT_TOLERANCE / 10 })
        ).toBe(true);
    });

    it('excludes a note beyond tolerance below the floor', () => {
        expect(
            isBeatInClipLoopWindow({ ...ANCHORED_CLIP, relativeBeat: -1 - CLIP_LOOP_WINDOW_BEAT_TOLERANCE * 2 })
        ).toBe(false);
    });

    it('excludes the loop-end note that drifts to one ulp below the ceiling', () => {
        // #5198's triplet-grid trim chain (start 0 → 1/6 → 1/6 + 1/4, L=4):
        // the offset wraps to 0.41666666666666696 while the advance reads
        // 0.41666666666666663, so the source-4 note lands at relative
        // 3.583333333333333 — one ulp inside the strict ceiling
        // 3.5833333333333335 — and must still stay out of every pass.
        const drifted = {
            startBeat: 0.41666666666666663,
            loopOriginBeat: 0,
            loopLengthBeats: 4,
            loopEnabled: true,
        } as const;
        expect(isBeatInClipLoopWindow({ ...drifted, relativeBeat: 4 - 0.41666666666666696 })).toBe(false);
    });

    it('keeps a note well inside the ceiling admitted despite the inward ceiling shift', () => {
        expect(isBeatInClipLoopWindow({ ...ANCHORED_CLIP, relativeBeat: 3 - 1e-3 })).toBe(true);
    });

    it('admits everything below the loop length for a clip without an anchor', () => {
        const legacy = { startBeat: 1, loopOriginBeat: undefined, loopLengthBeats: 4, loopEnabled: true } as const;
        expect(isBeatInClipLoopWindow({ ...legacy, relativeBeat: -10 })).toBe(true);
        expect(isBeatInClipLoopWindow({ ...legacy, relativeBeat: 3.5 })).toBe(true);
        expect(isBeatInClipLoopWindow({ ...legacy, relativeBeat: 4 })).toBe(false);
    });

    it('falls back to the pre-anchor law for a stale anchor while the loop is off', () => {
        expect(isBeatInClipLoopWindow({ ...STALE_ANCHOR_LOOP_OFF_CLIP, relativeBeat: -10 })).toBe(true);
        expect(isBeatInClipLoopWindow({ ...STALE_ANCHOR_LOOP_OFF_CLIP, relativeBeat: 3.5 })).toBe(true);
        expect(isBeatInClipLoopWindow({ ...STALE_ANCHOR_LOOP_OFF_CLIP, relativeBeat: 4 })).toBe(false);
    });

    it('falls back to the pre-anchor law for a non-finite anchor (#5198)', () => {
        // The corrupted anchor reads as absent, like the normalizer leaves the
        // document — not as an advance-zero window that would drop legacy
        // material below the region head.
        const corrupted = { ...ANCHORED_CLIP, loopOriginBeat: Number.POSITIVE_INFINITY } as const;
        expect(isBeatInClipLoopWindow({ ...corrupted, relativeBeat: -10 })).toBe(true);
        expect(isBeatInClipLoopWindow({ ...corrupted, relativeBeat: 3.5 })).toBe(true);
        expect(isBeatInClipLoopWindow({ ...corrupted, relativeBeat: 4 })).toBe(false);
    });
});

describe('resolveLoopedOffsetBeats', () => {
    const input = {
        loopEnabled: true,
        clipDurationBeats: 12,
        configuredLoopLengthBeats: 4,
    } as const;

    it('keeps the offset while the loop is off', () => {
        expect(resolveLoopedOffsetBeats({ ...input, loopEnabled: false, offsetBeats: -3 })).toBe(-3);
        expect(resolveLoopedOffsetBeats({ ...input, loopEnabled: false, offsetBeats: 9 })).toBe(9);
    });

    it('wraps the offset into the loop while the loop is on', () => {
        expect(resolveLoopedOffsetBeats({ ...input, offsetBeats: 4 })).toBe(0);
        expect(resolveLoopedOffsetBeats({ ...input, offsetBeats: 6 })).toBe(2);
        expect(resolveLoopedOffsetBeats({ ...input, offsetBeats: -1 })).toBe(3);
    });
});
