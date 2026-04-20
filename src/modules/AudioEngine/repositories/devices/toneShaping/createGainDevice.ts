import { type OfflineDeviceNode } from '../types';

// ── Gain ─────────────────────────────────────────────────────────────────

export function createGainDevice(ctx: BaseAudioContext): OfflineDeviceNode {
    const g = ctx.createGain();
    g.gain.value = 1;
    return { inputNode: g, outputNode: g, nodes: [g] };
}
