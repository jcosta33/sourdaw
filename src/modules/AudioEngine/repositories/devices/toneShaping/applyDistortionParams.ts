import { type OfflineDeviceNode } from '../types';

import { makeDistortionCurve } from './makeDistortionCurve';

export function applyDistortionParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dryDist = dn.nodes[1] as GainNode;
    const wetDist = dn.nodes[2] as GainNode;
    const shaperD = dn.nodes[3] as WaveShaperNode;
    const toneD = dn.nodes[4] as BiquadFilterNode;
    const outputLevel = dn.nodes[6] as GainNode;
    if (params['dist-drive'] !== undefined) {
        shaperD.curve = makeDistortionCurve(params['dist-drive']);
    }
    if (params['dist-tone'] !== undefined) {
        toneD.frequency.value = params['dist-tone'];
    }
    if (params['dist-output'] !== undefined) {
        outputLevel.gain.value = 10 ** (params['dist-output'] / 20);
    }
    if (params['dist-mix'] !== undefined) {
        wetDist.gain.value = params['dist-mix'];
        dryDist.gain.value = 1 - params['dist-mix'];
    }
}
