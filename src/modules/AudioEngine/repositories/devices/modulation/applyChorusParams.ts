import { type OfflineDeviceNode } from '../types';

export function applyChorusParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const nn = dn.namedNodes;
    const dry = (nn?.dry ?? dn.nodes[1]) as GainNode;
    const wet = (nn?.wet ?? dn.nodes[2]) as GainNode;
    const lfo1 = (nn?.lfo1 ?? dn.nodes[5]) as OscillatorNode;
    const lfo2 = (nn?.lfo2 ?? dn.nodes[6]) as OscillatorNode;
    const lfoGain1 = (nn?.lfoGain1 ?? dn.nodes[7]) as GainNode;
    const lfoGain2 = (nn?.lfoGain2 ?? dn.nodes[8]) as GainNode;
    if (params['chorus-rate'] !== undefined) {
        lfo1.frequency.value = params['chorus-rate'];
        lfo2.frequency.value = params['chorus-rate'] * 1.2;
    }
    if (params['chorus-depth'] !== undefined) {
        lfoGain1.gain.value = params['chorus-depth'] / 1000;
        lfoGain2.gain.value = params['chorus-depth'] / 1000;
    }
    if (params['chorus-mix'] !== undefined) {
        wet.gain.value = params['chorus-mix'];
        dry.gain.value = 1 - params['chorus-mix'];
    }
}
