/**
 * Digest-probe generation for the persisted-state matcher digest case. The case asserts that
 * `renderSavedProjectStateMatcherDigest` is a lossless encoding: every probe in this list must
 * render distinctly. The value domain and the joined split texts are chosen so a lossy renderer —
 * one that drops a field, the boundary between the two fields, a field role, or a kind, or that
 * lowercases, trims, length-encodes, or prefix-collapses a field — encodes two distinct probes
 * identically and so reddens the case. An injective re-encoding (reversing a field, say) is
 * lossless and is deliberately not rejected: the digest only has to keep distinct matchers
 * distinct, not to be a canonical form.
 */

import type { SavedProjectStateMatcher } from '../../savedProjectStatePaths.ts';

/**
 * The value domain the probes span. Each entry earns its place:
 * - `''` — a field may be empty.
 * - `a` and `b` — two distinct same-length values, so a length-encoding renderer collides.
 * - `A` — a letter-case variant of `a`, so a case-folding renderer collides.
 * - `a ` — a trailing-space variant of `a`, so a trimming renderer collides.
 * - `src/app/bootstrap` — the sample path, also split across its `/` separator below.
 * - `src/app/bootstrap.ts` — a second long value sharing the sample path's `src/app/` prefix, so a
 *   renderer that collapses a field to its directory or a shared prefix collides.
 */
export const DIGEST_VALUE_DOMAIN = ['', 'a', 'b', 'A', 'a ', 'src/app/bootstrap', 'src/app/bootstrap.ts'] as const;

export const SINGLE_FIELD_DIGEST_BUILDERS: ReadonlyArray<(value: string) => SavedProjectStateMatcher> = [
    (value) => ({ kind: 'wordPrefix', value }),
    (value) => ({ kind: 'substring', value }),
    (value) => ({ kind: 'prefix', value }),
    (value) => ({ kind: 'suffix', value }),
    (value) => ({ kind: 'exact', value }),
];

/**
 * The texts the two-field boundary split sweeps, both long and sharing the `src/app/` prefix, so the
 * boundary between the two fields shifts across the `/` separator in more than one long value.
 */
const JOINED_SPLIT_TEXTS = ['src/app/bootstrap', 'src/app/bootstrap.ts'] as const;

/**
 * Every single-field kind over the value domain, the two-field kind over the domain in both roles,
 * and every split of the joined texts. Distinct probes render distinctly under the real renderer; a
 * renderer with any of the lossy families named above collides two of them.
 */
export function generatedDigestProbes(): readonly SavedProjectStateMatcher[] {
    const probes: SavedProjectStateMatcher[] = [];
    for (const make of SINGLE_FIELD_DIGEST_BUILDERS) {
        for (const value of DIGEST_VALUE_DOMAIN) {
            probes.push(make(value));
        }
    }
    // Two-field pairs, deduplicated: whole-text splits coincide with a domain pair.
    const pairs = new Set<string>();
    const addPair = (prefix: string, substring: string): void => {
        const key = JSON.stringify([prefix, substring]);
        if (pairs.has(key)) {
            return;
        }
        pairs.add(key);
        probes.push({ kind: 'prefixAndSubstring', prefix, substring });
    };
    for (const prefix of DIGEST_VALUE_DOMAIN) {
        for (const substring of DIGEST_VALUE_DOMAIN) {
            addPair(prefix, substring);
        }
    }
    for (const joined of JOINED_SPLIT_TEXTS) {
        for (let index = 0; index <= joined.length; index += 1) {
            addPair(joined.slice(0, index), joined.slice(index));
        }
    }
    return probes;
}
