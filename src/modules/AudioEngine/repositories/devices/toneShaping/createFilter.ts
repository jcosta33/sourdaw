import { type OfflineDeviceNode } from '../types';

// ── Filter ───────────────────────────────────────────────────────────────

export function createFilter(ctx: BaseAudioContext): OfflineDeviceNode {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1;
    return { inputNode: filter, outputNode: filter, nodes: [filter] };
}