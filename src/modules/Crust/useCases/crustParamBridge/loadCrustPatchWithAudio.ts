import { type CrustPatch } from '../../models/CrustPatch';
import { loadCrustPatch } from '../../stores/crustStore';

import { encodeCrustValue, findDeviceRefCrust, paramBatcher, pushCrustParamImmediately } from './helpers';

export function loadCrustPatchWithAudio(deviceId: string, patch: CrustPatch): void {
    loadCrustPatch(patch);

    const ref = findDeviceRefCrust(deviceId);
    if (!ref) {
        return;
    }

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
            pushCrustParamImmediately(ref, key, encodedValue);
        }
    }
}
