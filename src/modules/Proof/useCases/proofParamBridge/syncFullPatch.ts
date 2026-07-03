import { getTrackStoreState } from '#/modules/Arrangement/useCases';

import { type DitherMode, type ProofPatch } from '../../models/ProofPatch';
import { ditherModeToInt } from '../../services/ditherModeToInt';
import { getProofState, proofStore, updateProofPatch } from '../../stores/proofStore';

import { bridges } from './helpers';
import { syncDynBands } from './syncDynBands';
import { syncEqBands } from './syncEqBands';
import { syncExciter } from './syncExciter';
import { syncImager } from './syncImager';

function isFiniteRestoredParam(value: number | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
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

    if (isFiniteRestoredParam(parameterValues.input_gain)) {
        restoredPatch.inputGain = parameterValues.input_gain;
    }

    if (isFiniteRestoredParam(parameterValues.output_gain)) {
        restoredPatch.outputGain = parameterValues.output_gain;
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

    if (isFiniteRestoredParam(parameterValues.lim_ceiling)) {
        restoredPatch.limCeiling = parameterValues.lim_ceiling;
    }

    if (isFiniteRestoredParam(parameterValues.lim_release)) {
        restoredPatch.limRelease = parameterValues.lim_release;
    }

    if (isFiniteRestoredParam(parameterValues.lim_lookahead)) {
        restoredPatch.limLookahead = parameterValues.lim_lookahead;
    }

    const imgAutoMonoBass = booleanFromRestoredParam(parameterValues.img_auto_mono_bass);
    if (imgAutoMonoBass !== null) {
        restoredPatch.imgAutoMonoBass = imgAutoMonoBass;
    }

    if (isFiniteRestoredParam(parameterValues.img_mono_bass_freq)) {
        restoredPatch.imgMonoBassFreq = parameterValues.img_mono_bass_freq;
    }

    const ditherMode = ditherModeFromInt(parameterValues.dither_mode);
    if (ditherMode !== null) {
        restoredPatch.ditherMode = ditherMode;
    }

    if (isFiniteRestoredParam(parameterValues.dither_bits)) {
        restoredPatch.ditherBits = parameterValues.dither_bits;
    }

    return restoredPatch;
}

function shouldRehydrateRestoredScalars(deviceId: string): boolean {
    return proofStore.value?.[deviceId] === undefined;
}

function rehydrateRestoredScalars(deviceId: string): void {
    if (!shouldRehydrateRestoredScalars(deviceId)) {
        return;
    }

    const parameterValues = getRestoredProofParameterValues(deviceId);
    if (!parameterValues) {
        return;
    }

    const restoredPatch = getRestoredScalarPatch(parameterValues);
    if (Object.keys(restoredPatch).length === 0) {
        return;
    }

    updateProofPatch({ deviceId, patch: restoredPatch });
}

/** Send full patch to engine (e.g., after preset load). */
export function syncFullPatch(deviceId: string): void {
    rehydrateRestoredScalars(deviceId);

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
