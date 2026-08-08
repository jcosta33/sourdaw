import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { type NoteName, NOTE_NAMES } from '#/utils/noteNames';

import { chromaFlatness } from '../services/chromaFlatness';
import { chromaFromSamples } from '../services/chromaFromSamples';
import { correlateKeyProfiles } from '../services/keyProfileCorrelation';

/**
 * Above this chroma flatness the material has no key to find: the twelve pitch
 * classes carry essentially equal energy, which describes noise, unpitched
 * percussion and a full chromatic aggregate alike.
 *
 * Calibrated here, not cited — no published numeric threshold for "no key"
 * exists, because MIREX-style evaluation assumes every excerpt has one.
 * Measured on this front end: white noise 0.948 (0.3 s) to 0.9998 (5 s) over
 * 40 seeds per length; a 12-tone cluster 0.980; a chromatic run 0.986. Tonal
 * material: a C major I-IV-V-I 0.512, an A minor i-iv-V-i 0.573, a dense jazz
 * voicing 0.344, and 0.898 for that same I-IV-V-I buried under white noise
 * three times its amplitude (where the key call was still correct). 0.92 sits
 * in the gap between the worst tonal case that still resolves and the flattest
 * broadband case.
 */
const ATONAL_FLATNESS_CEILING = 0.92;

/**
 * Below this relative gap to the runner-up the two readings are not meaningfully
 * distinguishable and the alternative is reported alongside the winner.
 *
 * The quantity is Essentia's `firstToSecondRelativeStrength`, `(r1 - r2) / r1`.
 * Measured: 0.235 for a C major I-IV-V-I and 0.311 for an A minor i-iv-V-i
 * (unambiguous), against 0.047 for a bare C major scale — the relative-key tie
 * MIREX scores at 0.3 — and 0.015 for a single sustained sine, which cannot
 * imply a mode at all.
 */
const CLOSE_CALL_RELATIVE_STRENGTH = 0.1;

type KeyReading = {
    key: NoteName;
    mode: 'major' | 'minor';
};

type DetectKeyResult =
    | (KeyReading & {
          detected: true;
          /**
           * Pearson correlation between the observed chroma and the winning
           * Krumhansl-Schmuckler profile, clamped to [0, 1]. This is Essentia's
           * `strength`: a correlation coefficient, bounded by the statistic
           * itself rather than by a divisor picked to make numbers look good.
           */
          confidence: number;
          /** The runner-up key, present only when it is too close to dismiss. */
          alternative?: KeyReading;
      })
    | { detected: false };

/**
 * Estimate the musical key of a cached audio buffer.
 *
 * Krumhansl (1990) ch. 4 defines key finding as the Pearson product-moment
 * correlation between the mean-centred pitch-class distribution and each of the
 * 24 rotated probe-tone profiles. The centring is not decoration: without it the
 * score reduces to a dot product dominated by the profile sums (minor 44.51,
 * major 41.79), so every broadband input reads as minor.
 *
 * Returns `null` when there is nothing to analyse (no cached buffer, or silence).
 * Returns `{ detected: false }` when analysis ran and the material has no key.
 */
export function detectKey(audioBufferId: string): DetectKeyResult | null {
    const buffer = getCachedAudioBuffer({ bufferId: audioBufferId });
    if (!buffer) {
        return null;
    }

    const chroma = chromaFromSamples({
        samples: buffer.getChannelData(0),
        sampleRate: buffer.sampleRate,
    });
    if (!chroma) {
        return null;
    }

    if (chromaFlatness(chroma) >= ATONAL_FLATNESS_CEILING) {
        return { detected: false };
    }

    const correlation = correlateKeyProfiles(chroma);
    if (!correlation) {
        return { detected: false };
    }

    const strength = correlation.best.correlation;
    if (strength <= 0) {
        return { detected: false };
    }

    const relativeStrength = (strength - correlation.runnerUp.correlation) / strength;
    const reading: DetectKeyResult = {
        detected: true,
        key: NOTE_NAMES[correlation.best.tonic]!,
        mode: correlation.best.mode,
        confidence: Math.min(1, strength),
    };

    if (relativeStrength < CLOSE_CALL_RELATIVE_STRENGTH) {
        return {
            ...reading,
            alternative: {
                key: NOTE_NAMES[correlation.runnerUp.tonic]!,
                mode: correlation.runnerUp.mode,
            },
        };
    }

    return reading;
}
