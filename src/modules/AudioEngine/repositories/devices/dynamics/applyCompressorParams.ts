import { type OfflineDeviceNode } from '../types';

export function applyCompressorParams(dn: OfflineDeviceNode, params: Record<string, number>, keyPrefix = 'comp'): void {
    const [comp, makeup] = dn.nodes as [DynamicsCompressorNode, GainNode];
    const threshold = params[`${keyPrefix}-threshold`];
    const ratio = params[`${keyPrefix}-ratio`];
    const attack = params[`${keyPrefix}-attack`];
    const release = params[`${keyPrefix}-release`];
    const knee = params[`${keyPrefix}-knee`];
    const makeupGain = params[`${keyPrefix}-makeup`];
    if (threshold !== undefined) {
        comp.threshold.value = threshold;
    }
    if (ratio !== undefined) {
        comp.ratio.value = Math.max(1, ratio);
    }
    if (attack !== undefined) {
        comp.attack.value = attack / 1000;
    }
    if (release !== undefined) {
        comp.release.value = release / 1000;
    }
    if (knee !== undefined) {
        comp.knee.value = knee;
    }
    if (makeupGain !== undefined) {
        makeup.gain.value = 10 ** (makeupGain / 20);
    }
}
