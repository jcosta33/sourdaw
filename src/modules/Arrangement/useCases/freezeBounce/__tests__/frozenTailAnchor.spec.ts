import { describe, expect, it } from 'vitest';

import { MIN_TEMPO } from '#/modules/Transport/stores';
import {
    LEGACY_FREEZE_MAX_TAIL_BEATS,
    LEGACY_FREEZE_MIN_TAIL_BEATS,
    UNKNOWN_FROZEN_TAIL_SECONDS,
} from '#/utils/frozenBufferTail';

/**
 * The unknown-baked-tail floor is a number in one file derived from mechanisms
 * in two others. Nothing but this spec connects them.
 *
 * The previous floor was wrong in exactly the way an unchecked anchor goes
 * wrong: it was justified against `AUTO_TAIL_SECONDS`, a constant belonging to
 * the bounce path that freeze never calls, and it was described as an upper
 * bound on freeze's tail while being smaller than it below 48 BPM. No test
 * connected the constant to the mechanism, so the justification could be false
 * without anything failing.
 */
describe('unknown frozen tail floor — anchored to freeze’s real mechanism', () => {
    it('equals the longest tail freeze can bake, at the slowest legal tempo', () => {
        // Freeze renders `tailBeats` past the content and beats lengthen as
        // tempo drops, so the worst case is the longer beat count at MIN_TEMPO.
        const longestFreezeTailSeconds = (LEGACY_FREEZE_MAX_TAIL_BEATS * 60) / MIN_TEMPO;

        expect(UNKNOWN_FROZEN_TAIL_SECONDS).toBe(longestFreezeTailSeconds);
    });

    it('is never shorter than a freeze tail at any legal tempo', () => {
        // The floor exists to stop an unknown tail truncating a buffer. A floor
        // below what the buffer can hold truncates it again — permanently, once
        // Flatten bakes the shortened clip into the timeline.
        for (const tempo of [MIN_TEMPO, 40, 47, 48, 60, 120, 180, 300]) {
            for (const beats of [LEGACY_FREEZE_MIN_TAIL_BEATS, LEGACY_FREEZE_MAX_TAIL_BEATS]) {
                const bakedSeconds = (beats * 60) / tempo;
                expect(
                    UNKNOWN_FROZEN_TAIL_SECONDS,
                    `floor is shorter than a ${beats}-beat freeze tail at ${tempo} BPM`
                ).toBeGreaterThanOrEqual(bakedSeconds);
            }
        }
    });

    it('would have rejected the previous 10 s floor', () => {
        // 8 beats at 20 BPM is 24 s; the old floor claimed to bound it at 10.
        const atSlowestTempo = (LEGACY_FREEZE_MAX_TAIL_BEATS * 60) / MIN_TEMPO;

        expect(atSlowestTempo).toBeGreaterThan(10);
        // And anything under 48 BPM already exceeded it.
        expect((LEGACY_FREEZE_MAX_TAIL_BEATS * 60) / 47).toBeGreaterThan(10);
    });
});
