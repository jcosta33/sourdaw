/**
 * Krumhansl-Schmuckler key finding — the correlation stage.
 *
 * Krumhansl (1990), *Cognitive Foundations of Musical Pitch*, ch. 4, defines
 * key finding as the **Pearson product-moment correlation** between the
 * observed pitch-class distribution and each of the 24 rotated probe-tone
 * profiles. Pearson is mean-centred on both sides; a raw dot product is not
 * the same statistic. Without the centring the score is dominated by the sum
 * of the profile (minor sums to 44.51, major to 41.79), so any broadband
 * input scores "minor" regardless of content.
 *
 * Kept pure and separate from the Goertzel front end so the classifier can be
 * exercised over large populations of chroma vectors without paying for DSP.
 */

/** Probe-tone ratings, C-rooted (Krumhansl & Kessler 1982; Krumhansl 1990 Table 2.1). */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const PITCH_CLASSES = 12;

type CentredProfile = {
    mode: 'major' | 'minor';
    /** Profile minus its own mean. */
    deviations: number[];
    /** Euclidean norm of `deviations` — the Pearson denominator contribution. */
    norm: number;
};

function centreProfile(profile: number[], mode: 'major' | 'minor'): CentredProfile {
    const mean = profile.reduce((total, value) => total + value, 0) / profile.length;
    const deviations = profile.map((value) => value - mean);
    const norm = Math.sqrt(deviations.reduce((total, value) => total + value * value, 0));
    return { mode, deviations, norm };
}

const CENTRED_PROFILES: CentredProfile[] = [
    centreProfile(MAJOR_PROFILE, 'major'),
    centreProfile(MINOR_PROFILE, 'minor'),
];

export type KeyProfileCandidate = {
    /** Pitch class of the tonic, 0 = C. */
    tonic: number;
    mode: 'major' | 'minor';
    /** Pearson r between the centred chroma and this key's centred profile, in [-1, 1]. */
    correlation: number;
};

export type CorrelateKeyProfilesOutput = {
    /** Highest-correlating of the 24 keys. */
    best: KeyProfileCandidate;
    /** Highest-correlating key that is not `best` — the closest competing interpretation. */
    runnerUp: KeyProfileCandidate;
};

/**
 * Correlate a 12-bin chroma vector against all 24 major/minor key profiles.
 *
 * Returns `null` when the input cannot carry a key at all: a wrong-length
 * vector, or a chroma with zero variance (every pitch class equally present).
 * A flat chroma has no Pearson correlation with anything — the denominator is
 * zero — and that is the honest answer, not a tie broken toward C minor.
 */
export function correlateKeyProfiles(chroma: readonly number[]): CorrelateKeyProfilesOutput | null {
    if (chroma.length !== PITCH_CLASSES) {
        return null;
    }

    const mean = chroma.reduce((total, value) => total + value, 0) / PITCH_CLASSES;
    const deviations: number[] = [];
    let sumSquares = 0;
    for (let index = 0; index < PITCH_CLASSES; index++) {
        const deviation = (chroma[index] ?? 0) - mean;
        deviations.push(deviation);
        sumSquares += deviation * deviation;
    }

    // Judge the spread relative to the level, not against exact zero: a chroma
    // of twelve equal bins leaves floating-point residue in the deviations, and
    // an absolute `=== 0` test lets that residue through as a correlation of
    // -2.6e-16 with a tonic decided by rounding.
    const chromaNorm = Math.sqrt(sumSquares);
    if (chromaNorm <= Math.max(Math.abs(mean), Number.MIN_VALUE) * 1e-9) {
        return null;
    }

    let best: KeyProfileCandidate | null = null;
    let runnerUp: KeyProfileCandidate | null = null;

    for (const profile of CENTRED_PROFILES) {
        for (let tonic = 0; tonic < PITCH_CLASSES; tonic++) {
            let covariance = 0;
            for (let index = 0; index < PITCH_CLASSES; index++) {
                covariance += (deviations[(index + tonic) % PITCH_CLASSES] ?? 0) * (profile.deviations[index] ?? 0);
            }

            const candidate: KeyProfileCandidate = {
                tonic,
                mode: profile.mode,
                correlation: covariance / (chromaNorm * profile.norm),
            };

            if (!best || candidate.correlation > best.correlation) {
                runnerUp = best;
                best = candidate;
                continue;
            }
            if (!runnerUp || candidate.correlation > runnerUp.correlation) {
                runnerUp = candidate;
            }
        }
    }

    if (!best || !runnerUp) {
        return null;
    }

    return { best, runnerUp };
}
