import { type OfflineDeviceNode } from '../types';

export function applySidechainCompressorParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const [comp, makeup] = dn.nodes as [DynamicsCompressorNode, GainNode];
    if (params['sc-comp-threshold'] !== undefined) {
        comp.threshold.value = params['sc-comp-threshold'];
    }
    if (params['sc-comp-ratio'] !== undefined) {
        comp.ratio.value = Math.max(1, params['sc-comp-ratio']);
    }
    if (params['sc-comp-attack'] !== undefined) {
        comp.attack.value = params['sc-comp-attack'] / 1000;
    }
    if (params['sc-comp-release'] !== undefined) {
        comp.release.value = params['sc-comp-release'] / 1000;
    }
    if (params['sc-comp-makeup'] !== undefined) {
        makeup.gain.value = 10 ** (params['sc-comp-makeup'] / 20);
    }
}