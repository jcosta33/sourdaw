/**
 * Chroma flatness — Wiener entropy (geometric mean / arithmetic mean) over the
 * 12 pitch-class bins.
 *
 * This answers a question the key correlation structurally cannot. Pearson
 * correlation is invariant to scale and offset, so it sees only the *shape* of
 * the chroma; a broadband signal whose bins differ by a fraction of a percent
 * still produces a shape, and the best of 24 key profiles will fit that shape
 * by chance (measured: r ≈ 0.45-0.50 on white noise). Flatness looks at the
 * quantity Pearson throws away — whether the energy is spread evenly across all
 * twelve pitch classes at all.
 *
 * 1 = perfectly uniform (noise, percussion, a full chromatic aggregate — none
 * of which have a key). Values near 0 = energy concentrated in a few pitch
 * classes.
 */
export function chromaFlatness(chroma: readonly number[]): number {
    if (chroma.length === 0) {
        return 0;
    }

    const epsilon = 1e-12;
    let logSum = 0;
    let sum = 0;
    for (const value of chroma) {
        logSum += Math.log(Math.max(value, epsilon));
        sum += value;
    }

    const arithmeticMean = sum / chroma.length;
    if (arithmeticMean <= 0) {
        return 0;
    }

    const geometricMean = Math.exp(logSum / chroma.length);
    return geometricMean / arithmeticMean;
}
