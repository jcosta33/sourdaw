/**
 * Linear Congruential Generator (LCG) — the classic glibc-style constants
 * `(state * 1103515245 + 12345) & 0x7fffffff`.
 *
 * Used by Yeast MIDI processors (Arpeggiator, Humanizer, MarkovChain, …) for
 * lightweight non-cryptographic randomness. Each processor holds its own
 * `state` (seeded independently) so different processors produce independent
 * streams from the same generator.
 *
 * Why LCG and not the project's `SeededRandom` (mulberry32)? The LCG sequence
 * is already embedded in processor behaviour via user-visible random picks —
 * switching to a different algorithm would change the output sequence for
 * the same seed. This helper preserves the exact bit pattern of the inline
 * duplication the processors used to carry (audit §49.3).
 *
 * Usage:
 *   private rngState = 0xdead;
 *   const next = nextLcg(this.rngState);
 *   this.rngState = next;
 *   const r = next / 0x7fffffff; // 0..1
 */

/** Return the next state value for the shared LCG. */
export function nextLcg(state: number): number {
    return (state * 1103515245 + 12345) & 0x7fffffff;
}

/** Max value returned by `nextLcg`, exclusive upper bound is `LCG_MAX + 1`. */
export const LCG_MAX = 0x7fffffff;
