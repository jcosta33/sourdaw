import { describe, expect, it } from 'vitest';

import { isBeatInClipLoopWindow, resolveClipLoopOriginAdvance } from '../clipLoopOrigin';

/**
 * The loop-window membership law behind #4988: the window is the half-open
 * region the clip was looped with, carried backwards by the trim advance in
 * the offset-relative coordinate. The issue's example is a 4-beat loop with
 * notes at source 0 and 4.5 — after a start trim by one beat the 4.5 note
 * must stay out of every pass, and the head note must stay in at its wrapped
 * phase. A clip without an anchor admits everything below the loop length,
 * exactly the pre-anchor law.
 */

const ANCHORED_CLIP = { startBeat: 1, loopOriginBeat: 0, loopLengthBeats: 4 } as const;

describe('resolveClipLoopOriginAdvance', () => {
    it('measures the trim advance from the anchor', () => {
        expect(resolveClipLoopOriginAdvance(ANCHORED_CLIP)).toBe(1);
    });

    it('advances zero for a clip without an anchor', () => {
        expect(resolveClipLoopOriginAdvance({ startBeat: 7, loopOriginBeat: undefined })).toBe(0);
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
        const clip = { startBeat: 5, loopOriginBeat: 0, loopLengthBeats: 4 } as const;
        expect(isBeatInClipLoopWindow({ ...clip, relativeBeat: -5 })).toBe(true); // source 0
        expect(isBeatInClipLoopWindow({ ...clip, relativeBeat: -0.5 })).toBe(false); // source 4.5
    });

    it('admits the region head inclusively and refuses the region end exclusively', () => {
        expect(isBeatInClipLoopWindow({ ...ANCHORED_CLIP, relativeBeat: -1 })).toBe(true);
        expect(isBeatInClipLoopWindow({ ...ANCHORED_CLIP, relativeBeat: 3 })).toBe(false);
    });

    it('admits everything below the loop length for a clip without an anchor', () => {
        const legacy = { startBeat: 1, loopOriginBeat: undefined, loopLengthBeats: 4 } as const;
        expect(isBeatInClipLoopWindow({ ...legacy, relativeBeat: -10 })).toBe(true);
        expect(isBeatInClipLoopWindow({ ...legacy, relativeBeat: 3.5 })).toBe(true);
        expect(isBeatInClipLoopWindow({ ...legacy, relativeBeat: 4 })).toBe(false);
    });
});
