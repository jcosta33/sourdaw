import { type OfflineDeviceNode } from '../types';

import { makeBitcrusherCurve } from './helpers';

export function applyBitcrusherParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dryBC = dn.nodes[1] as GainNode;
    const wetBC = dn.nodes[2] as GainNode;
    const shaperBC = dn.nodes[3] as WaveShaperNode;
    if (params['crush-bits'] !== undefined) {
        shaperBC.curve = makeBitcrusherCurve(Math.max(1, Math.round(params['crush-bits'])));
    }
    if (params['crush-mix'] !== undefined) {
        wetBC.gain.value = params['crush-mix'];
        dryBC.gain.value = 1 - params['crush-mix'];
    }
}
