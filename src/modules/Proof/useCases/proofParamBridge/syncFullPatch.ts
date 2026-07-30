import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getTrackStoreState } from '#/modules/Arrangement/useCases';

import { PROOF_PATCH_RANGES, TARGET_LUFS, type DitherMode, type ProofPatch } from '../../models/ProofPatch';
import { ditherModeToInt } from '../../services/ditherModeToInt';
import { getProofPatchParameterValues } from '../../services/getProofPatchParameterValues';
import { getRestoredProofChainOrder } from '../../services/getRestoredProofChainOrder';
import { isValidDynCrossoverFreqs } from '../../services/isValidDynCrossoverFreqs';
import { proofTargetFromInt } from '../../services/proofTargetCodec';
import { getProofState, hydrateProofPatch } from '../../stores/proofStore';
import { PROOF_PRESETS } from '../proofPresets';

import { bridges } from './helpers';
import { syncDynBands } from './syncDynBands';
import { syncEqBands } from './syncEqBands';
import { syncExciter } from './syncExciter';
import { syncImager } from './syncImager';

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

function getRestoredProofParameterValues(deviceId: string): Record<string, number> | null {
    const trackState = getTrackStoreState();
    if (!trackState) {
        return null;
    }

    for (const track of trackState.tracks) {
        const device = track.devices.find((candidate) => candidate.id === deviceId && candidate.type === 'proof');
        if (device) {
            return device.parameterValues;
        }
    }

    return null;
}

function getRestoredScalarPatch(parameterValues: Record<string, number>): Partial<ProofPatch> {
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

    const target = proofTargetFromInt(parameterValues.target_mode);
    const targetLufs = numberFromRestoredParam(parameterValues.target_lufs, PROOF_PATCH_RANGES.targetLufs);
    if (target !== null && targetLufs !== null && (target === 'custom' || targetLufs === TARGET_LUFS[target])) {
        restoredPatch.target = target;
        restoredPatch.targetLufs = targetLufs;
    }

    return restoredPatch;
}

function getRestoredEqBands(
    parameterValues: Record<string, number>,
    baseBands: ProofPatch['eqBands']
): ProofPatch['eqBands'] | null {
    const bands = baseBands.map((band, index) => {
        let restoredBand = false;
        const nextBand = { ...band };
        const freq = numberFromRestoredParam(parameterValues[`eq_band${index}_freq`], PROOF_PATCH_RANGES.eqBand.freq);
        if (freq !== null) {
            nextBand.freq = freq;
            restoredBand = true;
        }
        const gain = numberFromRestoredParam(parameterValues[`eq_band${index}_gain`], PROOF_PATCH_RANGES.eqBand.gain);
        if (gain !== null) {
            nextBand.gain = gain;
            restoredBand = true;
        }
        const q = numberFromRestoredParam(parameterValues[`eq_band${index}_q`], PROOF_PATCH_RANGES.eqBand.q);
        if (q !== null) {
            nextBand.q = q;
            restoredBand = true;
        }
        const type = integerFromRestoredParam(parameterValues[`eq_band${index}_type`], PROOF_PATCH_RANGES.eqBand.type);
        if (type !== null) {
            nextBand.type = type;
            restoredBand = true;
        }
        const channel = integerFromRestoredParam(
            parameterValues[`eq_band${index}_channel`],
            PROOF_PATCH_RANGES.eqBand.channel
        );
        if (channel !== null) {
            nextBand.channel = channel;
            restoredBand = true;
        }
        const enabled = booleanFromRestoredParam(parameterValues[`eq_band${index}_enabled`]);
        if (enabled !== null) {
            nextBand.enabled = enabled;
            restoredBand = true;
        }
        return { band: nextBand, restored: restoredBand };
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
        let restoredBand = false;
        const nextBand = { ...band };
        const threshold = numberFromRestoredParam(
            parameterValues[`dyn_band${index}_threshold`],
            PROOF_PATCH_RANGES.dynBand.threshold
        );
        if (threshold !== null) {
            nextBand.threshold = threshold;
            restoredBand = true;
        }
        const ratio = numberFromRestoredParam(
            parameterValues[`dyn_band${index}_ratio`],
            PROOF_PATCH_RANGES.dynBand.ratio
        );
        if (ratio !== null) {
            nextBand.ratio = ratio;
            restoredBand = true;
        }
        const attack = numberFromRestoredParam(
            parameterValues[`dyn_band${index}_attack`],
            PROOF_PATCH_RANGES.dynBand.attack
        );
        if (attack !== null) {
            nextBand.attack = attack;
            restoredBand = true;
        }
        const release = numberFromRestoredParam(
            parameterValues[`dyn_band${index}_release`],
            PROOF_PATCH_RANGES.dynBand.release
        );
        if (release !== null) {
            nextBand.release = release;
            restoredBand = true;
        }
        const knee = numberFromRestoredParam(parameterValues[`dyn_band${index}_knee`], PROOF_PATCH_RANGES.dynBand.knee);
        if (knee !== null) {
            nextBand.knee = knee;
            restoredBand = true;
        }
        const makeup = numberFromRestoredParam(
            parameterValues[`dyn_band${index}_makeup`],
            PROOF_PATCH_RANGES.dynBand.makeup
        );
        if (makeup !== null) {
            nextBand.makeup = makeup;
            restoredBand = true;
        }
        const autoMakeup = booleanFromRestoredParam(parameterValues[`dyn_band${index}_auto_makeup`]);
        if (autoMakeup !== null) {
            nextBand.autoMakeup = autoMakeup;
            restoredBand = true;
        }
        const bypassed = booleanFromRestoredParam(parameterValues[`dyn_band${index}_bypass`]);
        if (bypassed !== null) {
            nextBand.bypassed = bypassed;
            restoredBand = true;
        }
        return { band: nextBand, restored: restoredBand };
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
        let restoredBand = false;
        const nextBand = { ...band };
        const type = integerFromRestoredParam(
            parameterValues[`exc_band${index}_type`],
            PROOF_PATCH_RANGES.excBand.type
        );
        if (type !== null) {
            nextBand.type = type;
            restoredBand = true;
        }
        const drive = numberFromRestoredParam(
            parameterValues[`exc_band${index}_drive`],
            PROOF_PATCH_RANGES.excBand.drive
        );
        if (drive !== null) {
            nextBand.drive = drive;
            restoredBand = true;
        }
        const blend = numberFromRestoredParam(
            parameterValues[`exc_band${index}_blend`],
            PROOF_PATCH_RANGES.excBand.blend
        );
        if (blend !== null) {
            nextBand.blend = blend;
            restoredBand = true;
        }
        const enabled = booleanFromRestoredParam(parameterValues[`exc_band${index}_enabled`]);
        if (enabled !== null) {
            nextBand.enabled = enabled;
            restoredBand = true;
        }
        return { band: nextBand, restored: restoredBand };
    });

    return bands.some((entry) => entry.restored) ? bands.map((entry) => entry.band) : null;
}

function getRestoredProofPatch(parameterValues: Record<string, number>, basePatch: ProofPatch): Partial<ProofPatch> {
    const restoredPatch = getRestoredScalarPatch(parameterValues);
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
    return restoredPatch;
}

function getMatchingProofPreset(patch: ProofPatch) {
    const values = getProofPatchParameterValues(patch);
    const keys = Object.keys(values);

    const matches = PROOF_PRESETS.filter((preset) => {
        const presetValues = getProofPatchParameterValues(preset.patch);
        return (
            keys.length === Object.keys(presetValues).length && keys.every((key) => values[key] === presetValues[key])
        );
    });

    return matches.length === 1 ? matches[0] : undefined;
}

function rehydrateRestoredPatch(deviceId: string): void {
    const state = getProofState(deviceId);
    if (state.projectPatchHydrated) {
        return;
    }

    const parameterValues = getRestoredProofParameterValues(deviceId);
    if (!parameterValues) {
        return;
    }

    const restoredPatch = getRestoredProofPatch(parameterValues, state.patch);
    const matchingPreset = getMatchingProofPreset({ ...state.patch, ...restoredPatch });
    hydrateProofPatch({
        deviceId,
        patch: matchingPreset
            ? { ...restoredPatch, name: matchingPreset.name, presetId: matchingPreset.id }
            : { ...restoredPatch, presetId: undefined },
    });
}

/** Send full patch to engine (e.g., after preset load). */
export function syncFullPatch(deviceId: string): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    rehydrateRestoredPatch(deviceId);

    const state = getProofState(deviceId);
    const patch = state.patch;
    const bridge = bridges.get(deviceId);
    if (!bridge) {
        return;
    }

    // A/B compare (dry/wet at the chain head) is runtime state, not a saved
    // patch field, but the engine head must be re-established on a full sync
    // (e.g. preset load) or the chip and the audio fall out of agreement.
    bridge.setParam('ab_bypass', state.abBypass ? 1 : 0);
    bridge.setParam('input_gain', patch.inputGain);
    bridge.setParam('output_gain', patch.outputGain);
    bridge.setParam('eq_bypass', patch.eqBypassed ? 1 : 0);
    bridge.setParam('dyn_bypass', patch.dynBypassed ? 1 : 0);
    bridge.setParam('img_bypass', patch.imgBypassed ? 1 : 0);
    bridge.setParam('exc_bypass', patch.excBypassed ? 1 : 0);
    bridge.setParam('lim_bypass', patch.limBypassed ? 1 : 0);
    bridge.setParam('lim_ceiling', patch.limCeiling);
    bridge.setParam('lim_release', patch.limRelease);
    bridge.setParam('lim_lookahead', patch.limLookahead);
    bridge.setParam('dither_mode', ditherModeToInt(patch.ditherMode));
    bridge.setParam('dither_bits', patch.ditherBits);

    syncEqBands(deviceId);
    syncDynBands(deviceId);
    syncImager(deviceId);
    syncExciter(deviceId);

    bridge.reorderModules(patch.chainOrder);
}
