import { dbToGain } from '#/utils/audioLevelLaw';

import { type OfflineDeviceNode } from '../types';

import { makeCeilingClipCurve } from './makeCeilingClipCurve';

export function applyLimiterParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const nn = dn.namedNodes;
    const compL = (nn?.comp ?? dn.nodes[0]) as DynamicsCompressorNode;
    const ceilingL = (nn?.ceiling ?? dn.nodes[1]) as GainNode;
    const clipperL = (nn?.clipper ?? dn.nodes[2]) as WaveShaperNode;
    if (params['lim-threshold'] !== undefined) {
        compL.threshold.value = params['lim-threshold'];
    }
    if (params['lim-release'] !== undefined) {
        compL.release.value = params['lim-release'] / 1000;
    }
    if (params['lim-ceiling'] !== undefined) {
        const ceilingGain = dbToGain(params['lim-ceiling']);
        ceilingL.gain.value = ceilingGain;
        // The cap moves with the knob: rebuild the clip curve for the new
        // ceiling, exactly as the factory built it for the default.
        clipperL.curve = makeCeilingClipCurve(ceilingGain);
    }
}
