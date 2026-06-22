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

/**
 * Draw one Gaussian (normal) sample from the shared LCG via the Box-Muller
 * transform. Advances the LCG twice (two uniforms → one normal) and returns
 * both the sample and the new state so the caller can thread it forward
 * (the LCG is stateless here by design).
 *
 * Preserves the exact bit pattern the processors carried inline: two
 * `nextLcg` steps, each normalized by `LCG_MAX`, fed through
 * `mean + sigma * sqrt(-2 ln u1) * cos(2π u2)` with `u1` floored at 1e-10 to
 * avoid `log(0)`. No allocation beyond the returned tuple — safe on the
 * audio thread.
 */
export function gaussianLcg(state: number, mean: number, sigma: number): { value: number; state: number } {
    const s1 = nextLcg(state);
    const u1 = s1 / LCG_MAX;
    const s2 = nextLcg(s1);
    const u2 = s2 / LCG_MAX;
    const z = Math.sqrt(-2 * Math.log(Math.max(1e-10, u1))) * Math.cos(2 * Math.PI * u2);
    return { value: mean + sigma * z, state: s2 };
}
