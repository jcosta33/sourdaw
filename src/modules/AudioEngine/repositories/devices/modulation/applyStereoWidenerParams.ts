import { type OfflineDeviceNode } from '../types';

export function applyStereoWidenerParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const nn = dn.namedNodes;
    const midGain = (nn?.midGain ?? dn.nodes[7]) as GainNode;
    const sideGain = (nn?.sideGain ?? dn.nodes[8]) as GainNode;
    const monoBass = (nn?.monoBassFilter ?? dn.nodes[9]) as BiquadFilterNode;
    const sideLevel = (nn?.sideLevel ?? dn.nodes[11]) as GainNode;

    if (params['width-amount'] !== undefined) {
        sideGain.gain.value = params['width-amount'];
    }
    if (params['width-mid'] !== undefined) {
        // We'll apply it to the midGain node instead
        midGain.gain.value = 10 ** (params['width-mid'] / 20);
    }
    // Side Level, declared in dB (-12..+6): trims or boosts the side path
    // after width, before the decode matrix. 0 dB leaves it untouched.
    if (params['width-side'] !== undefined) {
        sideLevel.gain.value = 10 ** (params['width-side'] / 20);
    }
    if (params['width-mono-bass'] !== undefined) {
        monoBass.frequency.value = params['width-mono-bass'];
    }
}
