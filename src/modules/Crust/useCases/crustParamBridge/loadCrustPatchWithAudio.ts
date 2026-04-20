import { type CrustPatch } from '../../models/CrustPatch';
import { loadCrustPatch } from '../../stores/crustStore';

import { encodeCrustValue, findDeviceRefCrust, pushCrustParamImmediately } from './helpers';

export function loadCrustPatchWithAudio(deviceId: string, patch: CrustPatch): void {
    loadCrustPatch(patch);

    const ref = findDeviceRefCrust(deviceId);
    if (!ref) {
        return;
    }

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
        ['abSlot', patch.abSlot],
        ['scrollSpeed', patch.scrollSpeed],
    ];

    for (const [key, rawValue] of params) {
        const encodedValue = encodeCrustValue(key, rawValue);
        if (encodedValue !== null) {
            pushCrustParamImmediately(ref, key, encodedValue);
        }
    }
}
