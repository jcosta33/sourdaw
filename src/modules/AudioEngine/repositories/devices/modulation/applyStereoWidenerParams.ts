import { type OfflineDeviceNode } from '../types';

export function applyStereoWidenerParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const midGain = dn.nodes[7] as GainNode;
    const sideGain = dn.nodes[8] as GainNode;
    const monoBass = dn.nodes[9] as BiquadFilterNode;

    if (params['width-amount'] !== undefined) {
        sideGain.gain.value = params['width-amount'];
    }
    if (params['width-mid'] !== undefined) {
        // We'll apply it to the midGain node instead
        midGain.gain.value = 10 ** (params['width-mid'] / 20);
    }
    if (params['width-mono-bass'] !== undefined) {
        monoBass.frequency.value = params['width-mono-bass'];
    }
}