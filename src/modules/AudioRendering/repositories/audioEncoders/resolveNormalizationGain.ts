export type ResolveNormalizationGainInput = {
    /** Measured programme loudness, or null when the material has none (silence, too short). */
    integratedLufs: number | null;
    /** Measured true peak, linear (1 = 0 dBFS). */
    truePeak: number;
    /** Loudness the export should hit, in LUFS. */
    targetLufs: number;
    /** Inter-sample ceiling the output must not exceed, in dBTP. */
    ceilingDbTp: number;
};

export type ResolveNormalizationGainOutput = {
    /** Linear gain to apply before quantizing. */
    gain: number;
    /**
     * True when the true-peak ceiling, not the loudness target, decided the
     * gain — the export will sit below its target rather than clip.
     */
    limitedByCeiling: boolean;
};

/**
 * Resolve the single gain that takes a mix to its loudness target without
 * breaching the true-peak ceiling (OE-7).
 *
 * The two constraints can disagree: a heavily limited master may already be at
 * the ceiling well below the target loudness. Gain alone cannot satisfy both,
 * and the choice here is deliberate — the ceiling wins. Overshooting it would
 * mean inter-sample clipping in the delivered file, which is the failure this
 * stage exists to prevent, whereas landing under the target is merely quieter
 * than asked. Reaching the target in that case needs dynamics processing, which
 * belongs to a mastering device and not to a silent export-time stage.
 *
 * Nothing here ever boosts into the ceiling blindly: with no measurable
 * loudness the gain stays at unity.
 */
export function resolveNormalizationGain({
    integratedLufs,
    truePeak,
    targetLufs,
    ceilingDbTp,
}: ResolveNormalizationGainInput): ResolveNormalizationGainOutput {
    if (integratedLufs === null || !Number.isFinite(integratedLufs)) {
        return { gain: 1, limitedByCeiling: false };
    }

    const loudnessGain = Math.pow(10, (targetLufs - integratedLufs) / 20);
    const ceilingLinear = Math.pow(10, ceilingDbTp / 20);

    if (truePeak <= 0 || !Number.isFinite(truePeak)) {
        return { gain: loudnessGain, limitedByCeiling: false };
    }

    const maxGainBeforeCeiling = ceilingLinear / truePeak;
    if (loudnessGain > maxGainBeforeCeiling) {
        return { gain: maxGainBeforeCeiling, limitedByCeiling: true };
    }

    return { gain: loudnessGain, limitedByCeiling: false };
}
