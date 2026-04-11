import { type OfflineDeviceNode } from '../types';

export function applyFlangerParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dryF = dn.nodes[1] as GainNode;
    const wetF = dn.nodes[2] as GainNode;
    const delayF = dn.nodes[3] as DelayNode;
    const lfoF = dn.nodes[4] as OscillatorNode;
    const lfoGainF = dn.nodes[5] as GainNode;
    const feedbackF = dn.nodes[6] as GainNode;
    if (params['flanger-rate'] !== undefined) {
        lfoF.frequency.value = params['flanger-rate'];
    }
    if (params['flanger-depth'] !== undefined) {
        lfoGainF.gain.value = params['flanger-depth'] / 1000;
        delayF.delayTime.value = Math.max(0.001, params['flanger-depth'] / 1000);
    }
    if (params['flanger-feedback'] !== undefined) {
        feedbackF.gain.value = params['flanger-feedback'];
    }
    if (params['flanger-mix'] !== undefined) {
        wetF.gain.value = params['flanger-mix'];
        dryF.gain.value = 1 - params['flanger-mix'];
    }
}