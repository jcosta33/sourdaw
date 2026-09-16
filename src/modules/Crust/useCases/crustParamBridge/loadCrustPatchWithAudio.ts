import { quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { CRUST_PARAM_IDS, type CrustParamId } from '../../models/CrustParamIds';
import { asCrustOversampleFactor, type CrustPatch } from '../../models/CrustPatch';
import { loadCrustPatch } from '../../stores/crustStore';

import { createFlushHandlers } from './createFlushHandlers';
import { crustBridgeDeps, encodeCrustValue, paramBatcher } from './helpers';

const { pushParamImmediately: pushCrustParamImmediately } = createFlushHandlers(crustBridgeDeps);

export function loadCrustPatchWithAudio(deviceId: string, rawPatch: CrustPatch): void {
    const target = crustBridgeDeps.resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    // Resolve oversampling onto a factor the cascade builds before it reaches
    // the store or the engine. `CrustOversampleFactor` is a compile-time claim
    // and a loaded patch is runtime data — a hand-edited project, an import, or
    // a preset authored against the pre-2x list can carry 20 or 30, which the
    // engine would floor to 16 while `CrustPanel`'s chip row lit nothing and
    // the store kept the number nobody was playing. Gluten's loader has guarded
    // this since it shipped; Crust's did not.
    //
    // Asked of the Arrangement descriptor's declared legal set rather than a
    // second list here: the set, its resolution direction and the engine that
    // answers it are welded together in `DeviceLegalParameterValues.json`, and
    // a copy in this module would be a fourth place to drift.
    let patch = rawPatch;
    const declared = asCrustOversampleFactor(
        quantiseDeviceParameterValue({
            deviceType: 'crust',
            paramId: CRUST_PARAM_IDS.oversampling,
            value: rawPatch.oversampling,
        })
    );
    if (declared !== null && declared !== rawPatch.oversampling) {
        patch = { ...rawPatch, oversampling: declared };
    }

    loadCrustPatch(deviceId, patch);

    // Drop any rAF flush still pending from a prior knob drag so it can't fire
    // after these immediate pushes and overwrite a preset value with the stale
    // drag value (last-write-wins would otherwise favour the queued frame).
    paramBatcher.cancelAll();

    const params: Array<[CrustParamId, unknown]> = [
        [CRUST_PARAM_IDS.gain, patch.gain],
        [CRUST_PARAM_IDS.ceiling, patch.ceiling],
        [CRUST_PARAM_IDS.style, patch.style],
        [CRUST_PARAM_IDS.algorithm, patch.algorithm],
        [CRUST_PARAM_IDS.lookahead, patch.lookahead],
        [CRUST_PARAM_IDS.attack, patch.attack],
        [CRUST_PARAM_IDS.release, patch.release],
        [CRUST_PARAM_IDS.attackAuto, patch.attackAuto],
        [CRUST_PARAM_IDS.releaseAuto, patch.releaseAuto],
        [CRUST_PARAM_IDS.channelLinkTransient, patch.channelLinkTransient],
        [CRUST_PARAM_IDS.channelLinkRelease, patch.channelLinkRelease],
        [CRUST_PARAM_IDS.truePeak, patch.truePeak],
        [CRUST_PARAM_IDS.oversampling, patch.oversampling],
        [CRUST_PARAM_IDS.satEnabled, patch.satEnabled],
        [CRUST_PARAM_IDS.satAlgorithm, patch.satAlgorithm],
        [CRUST_PARAM_IDS.satDrive, patch.satDrive],
        [CRUST_PARAM_IDS.satMix, patch.satMix],
        [CRUST_PARAM_IDS.deltaListen, patch.deltaListen],
        [CRUST_PARAM_IDS.unityGain, patch.unityGain],
        [CRUST_PARAM_IDS.multiBand, patch.multiBand],
        [CRUST_PARAM_IDS.crossover1, patch.crossover1],
        [CRUST_PARAM_IDS.crossover2, patch.crossover2],
        [CRUST_PARAM_IDS.scHpfEnabled, patch.scHpfEnabled],
        [CRUST_PARAM_IDS.scHpfFreq, patch.scHpfFreq],
        [CRUST_PARAM_IDS.stereoMode, patch.stereoMode],
        [CRUST_PARAM_IDS.dither, patch.dither],
        [CRUST_PARAM_IDS.outputBitDepth, patch.outputBitDepth],
    ];

    for (const [key, rawValue] of params) {
        const encodedValue = encodeCrustValue(key, rawValue);
        // Push only a real numeric encoding. null = unknown enum (skip);
        // undefined = store-only key with no engine encoding (skip the push).
        // The params list carries no store-only keys today, but guarding both
        // keeps the push type-safe if one is ever added.
        if (typeof encodedValue === 'number') {
            pushCrustParamImmediately(deviceId, key, encodedValue);
        }
    }
}
