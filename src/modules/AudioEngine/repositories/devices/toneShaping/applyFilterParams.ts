import { type OfflineDeviceNode } from '../types';

export function applyFilterParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const filterNode = dn.nodes[0] as BiquadFilterNode;
    if (params['filter-cutoff'] !== undefined) {
        filterNode.frequency.value = params['filter-cutoff'];
    }
    if (params['filter-resonance'] !== undefined) {
        filterNode.Q.value = params['filter-resonance'];
    }
    if (params['filter-type'] !== undefined) {
        const types: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];
        filterNode.type = types[Math.round(params['filter-type'])] ?? 'lowpass';
    }
}
