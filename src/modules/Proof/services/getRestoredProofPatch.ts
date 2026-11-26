import { PROOF_PATCH_RANGES, type DitherMode, type ProofPatch } from '../models/ProofPatch';

import { getRestoredProofChainOrder } from './getRestoredProofChainOrder';
import { isValidDynCrossoverFreqs } from './isValidDynCrossoverFreqs';
import { readRestoredProofTarget } from './proofTargetCodec';

type NumberRange = readonly [min: number, max: number];

function numberFromRestoredParam(value: number | undefined, [min, max]: NumberRange): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        return null;
    }

    return value;
}

function booleanFromRestoredParam(value: number | undefined): boolean | null {
    if (value === 1) {
        return true;
    }

    if (value === 0) {
        return false;
    }

    return null;
}

function ditherModeFromInt(value: number | undefined): DitherMode | null {
    if (value === 0) {
        return 'off';
    }

    if (value === 1) {
        return 'tpdf';
    }

    if (value === 2) {
        return 'noise_shaped';
    }

    return null;
}

function integerFromRestoredParam(value: number | undefined, [min, max]: NumberRange): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        return null;
    }

    return value;
}

function getRestoredGainsAndBypasses(parameterValues: Record<string, number>): Partial<ProofPatch> {
    const restoredPatch: Partial<ProofPatch> = {};

    const inputGain = numberFromRestoredParam(parameterValues.input_gain, PROOF_PATCH_RANGES.inputGain);
    if (inputGain !== null) {
        restoredPatch.inputGain = inputGain;
    }

    const outputGain = numberFromRestoredParam(parameterValues.output_gain, PROOF_PATCH_RANGES.outputGain);
    if (outputGain !== null) {
        restoredPatch.outputGain = outputGain;
    }

    const eqBypassed = booleanFromRestoredParam(parameterValues.eq_bypass);
    if (eqBypassed !== null) {
        restoredPatch.eqBypassed = eqBypassed;
    }

    const dynBypassed = booleanFromRestoredParam(parameterValues.dyn_bypass);
    if (dynBypassed !== null) {
        restoredPatch.dynBypassed = dynBypassed;
    }

    const imgBypassed = booleanFromRestoredParam(parameterValues.img_bypass);
    if (imgBypassed !== null) {
        restoredPatch.imgBypassed = imgBypassed;
    }

    const excBypassed = booleanFromRestoredParam(parameterValues.exc_bypass);
    if (excBypassed !== null) {
        restoredPatch.excBypassed = excBypassed;
    }

    const limBypassed = booleanFromRestoredParam(parameterValues.lim_bypass);
    if (limBypassed !== null) {
        restoredPatch.limBypassed = limBypassed;
    }

    return restoredPatch;
}

function getRestoredLimiterAndImagerSettings(parameterValues: Record<string, number>): Partial<ProofPatch> {
    const restoredPatch: Partial<ProofPatch> = {};

    const limCeiling = numberFromRestoredParam(parameterValues.lim_ceiling, PROOF_PATCH_RANGES.limCeiling);
    if (limCeiling !== null) {
        restoredPatch.limCeiling = limCeiling;
    }

    const limRelease = numberFromRestoredParam(parameterValues.lim_release, PROOF_PATCH_RANGES.limRelease);
    if (limRelease !== null) {
        restoredPatch.limRelease = limRelease;
    }

    const limLookahead = numberFromRestoredParam(parameterValues.lim_lookahead, PROOF_PATCH_RANGES.limLookahead);
    if (limLookahead !== null) {
        restoredPatch.limLookahead = limLookahead;
    }

    const imgAutoMonoBass = booleanFromRestoredParam(parameterValues.img_auto_mono_bass);
    if (imgAutoMonoBass !== null) {
        restoredPatch.imgAutoMonoBass = imgAutoMonoBass;
    }

    const imgMonoBassFreq = numberFromRestoredParam(
        parameterValues.img_mono_bass_freq,
        PROOF_PATCH_RANGES.imgMonoBassFreq
    );
    if (imgMonoBassFreq !== null) {
        restoredPatch.imgMonoBassFreq = imgMonoBassFreq;
    }

    const ditherMode = ditherModeFromInt(parameterValues.dither_mode);
    if (ditherMode !== null) {
        restoredPatch.ditherMode = ditherMode;
    }

    const ditherBits = integerFromRestoredParam(parameterValues.dither_bits, PROOF_PATCH_RANGES.ditherBits);
    if (ditherBits === 16 || ditherBits === 24) {
        restoredPatch.ditherBits = ditherBits;
    }

    return restoredPatch;
}

function getRestoredEqBands(
    parameterValues: Record<string, number>,
    baseBands: ProofPatch['eqBands']
): ProofPatch['eqBands'] | null {
    const bands = baseBands.map((band, index) => {
        const freq = numberFromRestoredParam(parameterValues[`eq_band${index}_freq`], PROOF_PATCH_RANGES.eqBand.freq);
        const gain = numberFromRestoredParam(parameterValues[`eq_band${index}_gain`], PROOF_PATCH_RANGES.eqBand.gain);
        const q = numberFromRestoredParam(parameterValues[`eq_band${index}_q`], PROOF_PATCH_RANGES.eqBand.q);
        const type = integerFromRestoredParam(parameterValues[`eq_band${index}_type`], PROOF_PATCH_RANGES.eqBand.type);
        const channel = integerFromRestoredParam(
            parameterValues[`eq_band${index}_channel`],
            PROOF_PATCH_RANGES.eqBand.channel
        );
        const enabled = booleanFromRestoredParam(parameterValues[`eq_band${index}_enabled`]);
        return {
            band: {
                ...band,
                freq: freq ?? band.freq,
                gain: gain ?? band.gain,
                q: q ?? band.q,
                type: type ?? band.type,
                channel: channel ?? band.channel,
                enabled: enabled ?? band.enabled,
            },
            restored: [freq, gain, q, type, channel, enabled].some((value) => value !== null),
        };
    });

    return bands.some((entry) => entry.restored) ? bands.map((entry) => entry.band) : null;
}

function getRestoredDynCrossoverFreqs(
    parameterValues: Record<string, number>,
    baseFreqs: ProofPatch['dynCrossoverFreqs']
): ProofPatch['dynCrossoverFreqs'] | null {
    const freqs: ProofPatch['dynCrossoverFreqs'] = [baseFreqs[0], baseFreqs[1], baseFreqs[2]];
    let restored = false;
    for (let index = 0; index < freqs.length; index++) {
        const value = numberFromRestoredParam(
            parameterValues[`dyn_xover${index}`],
            PROOF_PATCH_RANGES.dynCrossoverFreq
        );
        if (value !== null) {
            freqs[index] = value;
            restored = true;
        }
    }

    return restored && isValidDynCrossoverFreqs(freqs) ? freqs : null;
}

function getRestoredDynBands(
    parameterValues: Record<string, number>,
    baseBands: ProofPatch['dynBands']
): ProofPatch['dynBands'] | null {
    const bands = baseBands.map((band, index) => {
        const threshold = numberFromRestoredParam(
            parameterValues[`dyn_band${index}_threshold`],
            PROOF_PATCH_RANGES.dynBand.threshold
        );
        const ratio = numberFromRestoredParam(
            parameterValues[`dyn_band${index}_ratio`],
            PROOF_PATCH_RANGES.dynBand.ratio
        );
        const attack = numberFromRestoredParam(
            parameterValues[`dyn_band${index}_attack`],
            PROOF_PATCH_RANGES.dynBand.attack
        );
        const release = numberFromRestoredParam(
            parameterValues[`dyn_band${index}_release`],
            PROOF_PATCH_RANGES.dynBand.release
        );
        const knee = numberFromRestoredParam(parameterValues[`dyn_band${index}_knee`], PROOF_PATCH_RANGES.dynBand.knee);
        const makeup = numberFromRestoredParam(
            parameterValues[`dyn_band${index}_makeup`],
            PROOF_PATCH_RANGES.dynBand.makeup
        );
        const autoMakeup = booleanFromRestoredParam(parameterValues[`dyn_band${index}_auto_makeup`]);
        const bypassed = booleanFromRestoredParam(parameterValues[`dyn_band${index}_bypass`]);
        return {
            band: {
                ...band,
                threshold: threshold ?? band.threshold,
                ratio: ratio ?? band.ratio,
                attack: attack ?? band.attack,
                release: release ?? band.release,
                knee: knee ?? band.knee,
                makeup: makeup ?? band.makeup,
                autoMakeup: autoMakeup ?? band.autoMakeup,
                bypassed: bypassed ?? band.bypassed,
            },
            restored: [threshold, ratio, attack, release, knee, makeup, autoMakeup, bypassed].some(
                (value) => value !== null
            ),
        };
    });

    return bands.some((entry) => entry.restored) ? bands.map((entry) => entry.band) : null;
}

function getRestoredImgBandWidth(
    parameterValues: Record<string, number>,
    baseWidths: ProofPatch['imgBandWidth']
): ProofPatch['imgBandWidth'] | null {
    const widths: ProofPatch['imgBandWidth'] = [baseWidths[0], baseWidths[1], baseWidths[2], baseWidths[3]];
    let restored = false;
    for (let index = 0; index < widths.length; index++) {
        const value = numberFromRestoredParam(parameterValues[`img_width${index}`], PROOF_PATCH_RANGES.imgBandWidth);
        if (value !== null) {
            widths[index] = value;
            restored = true;
        }
    }

    return restored ? widths : null;
}

function getRestoredExcBands(
    parameterValues: Record<string, number>,
    baseBands: ProofPatch['excBands']
): ProofPatch['excBands'] | null {
    const bands = baseBands.map((band, index) => {
        const type = integerFromRestoredParam(
            parameterValues[`exc_band${index}_type`],
            PROOF_PATCH_RANGES.excBand.type
        );
        const drive = numberFromRestoredParam(
            parameterValues[`exc_band${index}_drive`],
            PROOF_PATCH_RANGES.excBand.drive
        );
        const blend = numberFromRestoredParam(
            parameterValues[`exc_band${index}_blend`],
            PROOF_PATCH_RANGES.excBand.blend
        );
        const enabled = booleanFromRestoredParam(parameterValues[`exc_band${index}_enabled`]);
        return {
            band: {
                ...band,
                type: type ?? band.type,
                drive: drive ?? band.drive,
                blend: blend ?? band.blend,
                enabled: enabled ?? band.enabled,
            },
            restored: [type, drive, blend, enabled].some((value) => value !== null),
        };
    });

    return bands.some((entry) => entry.restored) ? bands.map((entry) => entry.band) : null;
}

export function getRestoredProofPatch(parameterValues: Record<string, number>, basePatch: ProofPatch): ProofPatch {
    const restoredPatch = {
        ...getRestoredGainsAndBypasses(parameterValues),
        ...getRestoredLimiterAndImagerSettings(parameterValues),
        ...readRestoredProofTarget(parameterValues),
    };
    const eqBands = getRestoredEqBands(parameterValues, basePatch.eqBands);
    if (eqBands) {
        restoredPatch.eqBands = eqBands;
    }
    const dynCrossoverFreqs = getRestoredDynCrossoverFreqs(parameterValues, basePatch.dynCrossoverFreqs);
    if (dynCrossoverFreqs) {
        restoredPatch.dynCrossoverFreqs = dynCrossoverFreqs;
    }
    const dynBands = getRestoredDynBands(parameterValues, basePatch.dynBands);
    if (dynBands) {
        restoredPatch.dynBands = dynBands;
    }
    const imgBandWidth = getRestoredImgBandWidth(parameterValues, basePatch.imgBandWidth);
    if (imgBandWidth) {
        restoredPatch.imgBandWidth = imgBandWidth;
    }
    const excBands = getRestoredExcBands(parameterValues, basePatch.excBands);
    if (excBands) {
        restoredPatch.excBands = excBands;
    }
    const chainOrder = getRestoredProofChainOrder(parameterValues);
    if (chainOrder) {
        restoredPatch.chainOrder = chainOrder;
    }
    return { ...basePatch, ...restoredPatch };
}
