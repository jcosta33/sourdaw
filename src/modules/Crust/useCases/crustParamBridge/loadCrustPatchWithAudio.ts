import { quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';

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
        quantiseDeviceParameterValue({ deviceType: 'crust', paramId: 'oversampling', value: rawPatch.oversampling })
    );
    if (declared !== null && declared !== rawPatch.oversampling) {
        patch = { ...rawPatch, oversampling: declared };
    }

    loadCrustPatch(patch);

    // Drop any rAF flush still pending from a prior knob drag so it can't fire
    // after these immediate pushes and overwrite a preset value with the stale
    // drag value (last-write-wins would otherwise favour the queued frame).
    paramBatcher.cancelAll();

    const params: Array<[string, unknown]> = [
        ['gain', patch.gain],
        ['ceiling', patch.ceiling],
        ['style', patch.style],
        ['algorithm', patch.algorithm],
        ['lookahead', patch.lookahead],
        ['attack', patch.attack],
        ['release', patch.release],
        ['attackAuto', patch.attackAuto],
        ['releaseAuto', patch.releaseAuto],
        ['channelLinkTransient', patch.channelLinkTransient],
        ['channelLinkRelease', patch.channelLinkRelease],
        ['truePeak', patch.truePeak],
        ['oversampling', patch.oversampling],
        ['satEnabled', patch.satEnabled],
        ['satAlgorithm', patch.satAlgorithm],
        ['satDrive', patch.satDrive],
        ['satMix', patch.satMix],
        ['deltaListen', patch.deltaListen],
        ['unityGain', patch.unityGain],
        ['multiBand', patch.multiBand],
        ['crossover1', patch.crossover1],
        ['crossover2', patch.crossover2],
        ['scHpfEnabled', patch.scHpfEnabled],
        ['scHpfFreq', patch.scHpfFreq],
        ['stereoMode', patch.stereoMode],
        ['dither', patch.dither],
        ['outputBitDepth', patch.outputBitDepth],
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
