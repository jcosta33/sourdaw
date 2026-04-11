import { type OfflineDeviceNode } from '../types';

export function applyDeEsserParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const bandpassDE = dn.nodes[3] as BiquadFilterNode;
    const compDE = dn.nodes[4] as DynamicsCompressorNode;
    if (params['deess-threshold'] !== undefined) {
        compDE.threshold.value = params['deess-threshold'];
    }
    if (params['deess-freq'] !== undefined) {
        bandpassDE.frequency.value = params['deess-freq'];
    }
    if (params['deess-range'] !== undefined) {
        compDE.ratio.value = Math.max(1, Math.abs(params['deess-range']) / 2);
    }
}