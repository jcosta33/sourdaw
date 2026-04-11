import { type OfflineDeviceNode } from '../types';

export function applyChorusParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dry = dn.nodes[1] as GainNode;
    const wet = dn.nodes[2] as GainNode;
    const lfo1 = dn.nodes[5] as OscillatorNode;
    const lfoGain = dn.nodes[7] as GainNode;
    if (params['chorus-rate'] !== undefined) {
        lfo1.frequency.value = params['chorus-rate'];
    }
    if (params['chorus-depth'] !== undefined) {
        lfoGain.gain.value = params['chorus-depth'] / 1000;
    }
    if (params['chorus-mix'] !== undefined) {
        wet.gain.value = params['chorus-mix'];
        dry.gain.value = 1 - params['chorus-mix'];
    }
}