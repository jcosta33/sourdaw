import { type OfflineDeviceNode } from '../types';

export function applyTremoloParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const lfoT = dn.nodes[2] as OscillatorNode;
    const lfoDepthT = dn.nodes[3] as GainNode;
    if (params['trem-rate'] !== undefined) {
        lfoT.frequency.value = params['trem-rate'];
    }
    if (params['trem-depth'] !== undefined) {
        lfoDepthT.gain.value = params['trem-depth'];
    }
    if (params['trem-shape'] !== undefined) {
        lfoT.type = params['trem-shape'] === 1 ? 'square' : 'sine';
    }
}