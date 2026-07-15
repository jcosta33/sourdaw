import { type ProofPatch } from '../models/ProofPatch';

import { ditherModeToInt } from './ditherModeToInt';
import { proofTargetToInt } from './proofTargetCodec';

export function getProofPatchParameterValues(patch: ProofPatch): Record<string, number> {
    const parameterValues: Record<string, number> = {
        input_gain: patch.inputGain,
        output_gain: patch.outputGain,
        eq_bypass: patch.eqBypassed ? 1 : 0,
        dyn_bypass: patch.dynBypassed ? 1 : 0,
        img_bypass: patch.imgBypassed ? 1 : 0,
        img_auto_mono_bass: patch.imgAutoMonoBass ? 1 : 0,
        img_mono_bass_freq: patch.imgMonoBassFreq,
        exc_bypass: patch.excBypassed ? 1 : 0,
        lim_bypass: patch.limBypassed ? 1 : 0,
        lim_ceiling: patch.limCeiling,
        lim_release: patch.limRelease,
        lim_lookahead: patch.limLookahead,
        dither_mode: ditherModeToInt(patch.ditherMode),
        dither_bits: patch.ditherBits,
        target_mode: proofTargetToInt(patch.target),
        target_lufs: patch.targetLufs,
    };

    for (const [index, band] of patch.eqBands.entries()) {
        parameterValues[`eq_band${index}_freq`] = band.freq;
        parameterValues[`eq_band${index}_gain`] = band.gain;
        parameterValues[`eq_band${index}_q`] = band.q;
        parameterValues[`eq_band${index}_type`] = band.type;
        parameterValues[`eq_band${index}_channel`] = band.channel;
        parameterValues[`eq_band${index}_enabled`] = band.enabled ? 1 : 0;
    }

    for (const [index, value] of patch.dynCrossoverFreqs.entries()) {
        parameterValues[`dyn_xover${index}`] = value;
    }

    for (const [index, band] of patch.dynBands.entries()) {
        parameterValues[`dyn_band${index}_threshold`] = band.threshold;
        parameterValues[`dyn_band${index}_ratio`] = band.ratio;
        parameterValues[`dyn_band${index}_attack`] = band.attack;
        parameterValues[`dyn_band${index}_release`] = band.release;
        parameterValues[`dyn_band${index}_knee`] = band.knee;
        parameterValues[`dyn_band${index}_makeup`] = band.makeup;
        parameterValues[`dyn_band${index}_auto_makeup`] = band.autoMakeup ? 1 : 0;
        parameterValues[`dyn_band${index}_bypass`] = band.bypassed ? 1 : 0;
    }

    for (const [index, value] of patch.imgBandWidth.entries()) {
        parameterValues[`img_width${index}`] = value;
    }

    for (const [index, band] of patch.excBands.entries()) {
        parameterValues[`exc_band${index}_type`] = band.type;
        parameterValues[`exc_band${index}_drive`] = band.drive;
        parameterValues[`exc_band${index}_blend`] = band.blend;
        parameterValues[`exc_band${index}_enabled`] = band.enabled ? 1 : 0;
    }

    for (const [index, value] of patch.chainOrder.entries()) {
        parameterValues[`chain_order_${index}`] = value;
    }

    return parameterValues;
}
