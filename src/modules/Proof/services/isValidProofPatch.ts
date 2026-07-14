import { DEFAULT_PATCH, TARGET_LUFS, type ProofPatch } from '../models/ProofPatch';

import { isValidDynCrossoverFreqs } from './isValidDynCrossoverFreqs';
import { isValidProofChainOrder } from './isValidProofChainOrder';
import { PROOF_PATCH_RANGES } from './proofPatchRanges';

type NumberRange = readonly [min: number, max: number];

const DITHER_MODES: readonly ProofPatch['ditherMode'][] = ['off', 'tpdf', 'noise_shaped'];

function isNumberInRange(value: number, [min, max]: NumberRange): boolean {
    return Number.isFinite(value) && value >= min && value <= max;
}

function isIntegerInRange(value: number, range: NumberRange): boolean {
    return Number.isInteger(value) && isNumberInRange(value, range);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
    return typeof value === 'object' && value !== null;
}

function isDenseWithSameLength(values: readonly unknown[], reference: readonly unknown[]): boolean {
    if (values.length !== reference.length) {
        return false;
    }
    for (let index = 0; index < values.length; index++) {
        if (!(index in values)) {
            return false;
        }
    }
    return true;
}

export function isValidProofPatch(patch: ProofPatch): boolean {
    if (!isRecord(patch) || !Object.hasOwn(TARGET_LUFS, patch.target)) {
        return false;
    }

    const scalarBooleans = [
        patch.eqBypassed,
        patch.dynBypassed,
        patch.imgBypassed,
        patch.imgAutoMonoBass,
        patch.excBypassed,
        patch.limBypassed,
    ];
    const targetMatches = patch.target === 'custom' || patch.targetLufs === TARGET_LUFS[patch.target];

    return (
        typeof patch.name === 'string' &&
        (patch.presetId === undefined || typeof patch.presetId === 'string') &&
        Array.isArray(patch.chainOrder) &&
        isValidProofChainOrder(patch.chainOrder) &&
        isNumberInRange(patch.inputGain, PROOF_PATCH_RANGES.inputGain) &&
        isNumberInRange(patch.outputGain, PROOF_PATCH_RANGES.outputGain) &&
        scalarBooleans.every((value) => typeof value === 'boolean') &&
        Array.isArray(patch.eqBands) &&
        isDenseWithSameLength(patch.eqBands, DEFAULT_PATCH.eqBands) &&
        patch.eqBands.every(
            (band) =>
                isRecord(band) &&
                typeof band.enabled === 'boolean' &&
                isIntegerInRange(band.type, PROOF_PATCH_RANGES.eqBand.type) &&
                isIntegerInRange(band.channel, PROOF_PATCH_RANGES.eqBand.channel) &&
                isNumberInRange(band.freq, PROOF_PATCH_RANGES.eqBand.freq) &&
                isNumberInRange(band.gain, PROOF_PATCH_RANGES.eqBand.gain) &&
                isNumberInRange(band.q, PROOF_PATCH_RANGES.eqBand.q)
        ) &&
        Array.isArray(patch.dynCrossoverFreqs) &&
        isDenseWithSameLength(patch.dynCrossoverFreqs, DEFAULT_PATCH.dynCrossoverFreqs) &&
        isValidDynCrossoverFreqs(patch.dynCrossoverFreqs) &&
        Array.isArray(patch.dynBands) &&
        isDenseWithSameLength(patch.dynBands, DEFAULT_PATCH.dynBands) &&
        patch.dynBands.every(
            (band) =>
                isRecord(band) &&
                isNumberInRange(band.threshold, PROOF_PATCH_RANGES.dynBand.threshold) &&
                isNumberInRange(band.ratio, PROOF_PATCH_RANGES.dynBand.ratio) &&
                isNumberInRange(band.attack, PROOF_PATCH_RANGES.dynBand.attack) &&
                isNumberInRange(band.release, PROOF_PATCH_RANGES.dynBand.release) &&
                isNumberInRange(band.knee, PROOF_PATCH_RANGES.dynBand.knee) &&
                isNumberInRange(band.makeup, PROOF_PATCH_RANGES.dynBand.makeup) &&
                typeof band.autoMakeup === 'boolean' &&
                typeof band.bypassed === 'boolean'
        ) &&
        Array.isArray(patch.imgBandWidth) &&
        isDenseWithSameLength(patch.imgBandWidth, DEFAULT_PATCH.imgBandWidth) &&
        patch.imgBandWidth.every((width) => isNumberInRange(width, PROOF_PATCH_RANGES.imgBandWidth)) &&
        isNumberInRange(patch.imgMonoBassFreq, PROOF_PATCH_RANGES.imgMonoBassFreq) &&
        Array.isArray(patch.excBands) &&
        isDenseWithSameLength(patch.excBands, DEFAULT_PATCH.excBands) &&
        patch.excBands.every(
            (band) =>
                isRecord(band) &&
                isIntegerInRange(band.type, PROOF_PATCH_RANGES.excBand.type) &&
                isNumberInRange(band.drive, PROOF_PATCH_RANGES.excBand.drive) &&
                isNumberInRange(band.blend, PROOF_PATCH_RANGES.excBand.blend) &&
                typeof band.enabled === 'boolean'
        ) &&
        isNumberInRange(patch.limCeiling, PROOF_PATCH_RANGES.limCeiling) &&
        isNumberInRange(patch.limRelease, PROOF_PATCH_RANGES.limRelease) &&
        isNumberInRange(patch.limLookahead, PROOF_PATCH_RANGES.limLookahead) &&
        DITHER_MODES.includes(patch.ditherMode) &&
        isIntegerInRange(patch.ditherBits, PROOF_PATCH_RANGES.ditherBits) &&
        (patch.ditherBits === 16 || patch.ditherBits === 24) &&
        isNumberInRange(patch.targetLufs, PROOF_PATCH_RANGES.targetLufs) &&
        targetMatches
    );
}
