import { type OfflineDeviceNode } from '../types';

// ── EQ ──────────────────────────────────────────────────────────────────

export function createEq(ctx: BaseAudioContext): OfflineDeviceNode {
    const low = ctx.createBiquadFilter();
    low.type = 'peaking';
    low.frequency.value = 100;
    low.Q.value = 1;
    low.gain.value = 0;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1000;
    mid.Q.value = 1;
    mid.gain.value = 0;
    const high = ctx.createBiquadFilter();
    high.type = 'peaking';
    high.frequency.value = 8000;
    high.Q.value = 1;
    high.gain.value = 0;
    low.connect(mid);
    mid.connect(high);
    return { inputNode: low, outputNode: high, nodes: [low, mid, high] };
}
