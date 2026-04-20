import { type OfflineDeviceNode } from '../types';

export function applyAutoPanParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const nn = dn.namedNodes;
    const lfoAP = (nn?.lfo ?? dn.nodes[5]) as OscillatorNode;
    const lfoGainLAP = (nn?.lfoGainL ?? dn.nodes[6]) as GainNode;
    const lfoGainRAP = (nn?.lfoGainR ?? dn.nodes[7]) as GainNode;
    if (params['autopan-rate'] !== undefined) {
        lfoAP.frequency.value = params['autopan-rate'];
    }
    if (params['autopan-depth'] !== undefined) {
        lfoGainLAP.gain.value = params['autopan-depth'] * 0.5;
        lfoGainRAP.gain.value = -(params['autopan-depth'] * 0.5);
    }
    if (params['autopan-shape'] !== undefined) {
        lfoAP.type = params['autopan-shape'] === 1 ? 'triangle' : 'sine';
    }
}
