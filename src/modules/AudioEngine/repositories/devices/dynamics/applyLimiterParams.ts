import { type OfflineDeviceNode } from '../types';

export function applyLimiterParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const compL = dn.nodes[0] as DynamicsCompressorNode;
    const ceilingL = dn.nodes[1] as GainNode;
    if (params['lim-threshold'] !== undefined) {
        compL.threshold.value = params['lim-threshold'];
    }
    if (params['lim-release'] !== undefined) {
        compL.release.value = params['lim-release'] / 1000;
    }
    if (params['lim-ceiling'] !== undefined) {
        ceilingL.gain.value = 10 ** (params['lim-ceiling'] / 20);
    }
}
