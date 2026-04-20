import { type OfflineDeviceNode } from '../types';

export function applyEqParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const [low, mid, high] = dn.nodes as [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
    if (params['eq-low-gain'] !== undefined) {
        low.gain.value = params['eq-low-gain'];
    }
    if (params['eq-low-freq'] !== undefined) {
        low.frequency.value = params['eq-low-freq'];
    }
    if (params['eq-low-q'] !== undefined) {
        low.Q.value = params['eq-low-q'];
    }
    if (params['eq-mid-gain'] !== undefined) {
        mid.gain.value = params['eq-mid-gain'];
    }
    if (params['eq-mid-freq'] !== undefined) {
        mid.frequency.value = params['eq-mid-freq'];
    }
    if (params['eq-mid-q'] !== undefined) {
        mid.Q.value = params['eq-mid-q'];
    }
    if (params['eq-high-gain'] !== undefined) {
        high.gain.value = params['eq-high-gain'];
    }
    if (params['eq-high-freq'] !== undefined) {
        high.frequency.value = params['eq-high-freq'];
    }
    if (params['eq-high-q'] !== undefined) {
        high.Q.value = params['eq-high-q'];
    }
}
