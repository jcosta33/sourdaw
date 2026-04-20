import { type OfflineDeviceNode } from '../types';

export function applyGainParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const g = dn.nodes[0] as GainNode;
    if (params['gain-level'] !== undefined) {
        g.gain.value = 10 ** (params['gain-level'] / 20);
    }
}
