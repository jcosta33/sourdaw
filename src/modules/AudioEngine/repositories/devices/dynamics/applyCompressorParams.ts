import { type OfflineDeviceNode } from '../types';

export function applyCompressorParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const [comp, makeup] = dn.nodes as [DynamicsCompressorNode, GainNode];
    if (params['comp-threshold'] !== undefined) {
        comp.threshold.value = params['comp-threshold'];
    }
    if (params['comp-ratio'] !== undefined) {
        comp.ratio.value = Math.max(1, params['comp-ratio']);
    }
    if (params['comp-attack'] !== undefined) {
        comp.attack.value = params['comp-attack'] / 1000;
    }
    if (params['comp-release'] !== undefined) {
        comp.release.value = params['comp-release'] / 1000;
    }
    if (params['comp-knee'] !== undefined) {
        comp.knee.value = params['comp-knee'];
    }
    if (params['comp-makeup'] !== undefined) {
        makeup.gain.value = 10 ** (params['comp-makeup'] / 20);
    }
}