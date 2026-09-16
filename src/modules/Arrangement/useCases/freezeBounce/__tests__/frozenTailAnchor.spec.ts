import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MIN_TEMPO } from '#/modules/Transport/stores';
import {
    LEGACY_FREEZE_MAX_TAIL_BEATS,
    LEGACY_FREEZE_MIN_TAIL_BEATS,
    UNKNOWN_FROZEN_TAIL_SECONDS,
} from '#/utils/frozenBufferTail';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../../');
const TEMPO_MAP_SOURCE = readFileSync(join(REPO_ROOT, 'src/modules/Transport/models/TempoMap.ts'), 'utf8');

// Inlined from Transport's `models/TempoMap.ts` — models constants never cross
// module boundaries (docs/architecture/03-typescript-module.md §4.1). The weld
// to its owner is a source read: the cross-check test parses the owner's own
// declaration and asserts this mirror still equals it.
const MIN_TEMPO_MAP_TEMPO = 20;

function parseMinTempoMapTempo(source: string): number {
    const declaration = /export const MIN_TEMPO_MAP_TEMPO = (\d+);/u.exec(source);
    if (!declaration) {
        throw new Error('MIN_TEMPO_MAP_TEMPO is not declared as a plain integer in models/TempoMap.ts');
    }
    return Number(declaration[1]);
}

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

    it('clears every tempo floor the project validators will accept, not just one of them', () => {
        // Two validators accept a tempo, and they are not the same validator:
        // the transport's own tempo and a tempo-map change are range-checked
        // separately, and their ranges already differ at the top (300 against
        // 999). The floor is derived from *the slowest tempo a project can
        // legally hold*, so it has to clear the smaller of the two minima —
        // whichever that turns out to be.
        //
        // This is the assertion that closes the class. Deduplicating the
        // constants would not: the previous derivation was checked against the
        // transport's copy alone, so lowering the tempo-map copy would have left
        // the floor silently wrong with every test still green. Nothing but a
        // test spanning the boundary can see that, because the copies agree at
        // the moment they are written. The span is a source read — the owner
        // cannot be imported across the boundary (§4.1), so the mirror above is
        // checked against the value parsed from the owner's own declaration.
        expect(MIN_TEMPO_MAP_TEMPO).toBe(parseMinTempoMapTempo(TEMPO_MAP_SOURCE));
        const slowestLegalTempo = Math.min(MIN_TEMPO, MIN_TEMPO_MAP_TEMPO);

        expect(UNKNOWN_FROZEN_TAIL_SECONDS).toBeGreaterThanOrEqual(
            (LEGACY_FREEZE_MAX_TAIL_BEATS * 60) / slowestLegalTempo
        );
    });

    it('would have rejected the previous 10 s floor', () => {
        // 8 beats at 20 BPM is 24 s; the old floor claimed to bound it at 10.
        const atSlowestTempo = (LEGACY_FREEZE_MAX_TAIL_BEATS * 60) / MIN_TEMPO;

        expect(atSlowestTempo).toBeGreaterThan(10);
        // And anything under 48 BPM already exceeded it.
        expect((LEGACY_FREEZE_MAX_TAIL_BEATS * 60) / 47).toBeGreaterThan(10);
    });
});
