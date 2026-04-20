import { type OfflineDeviceNode } from '../types';

// ── Limiter ──────────────────────────────────────────────────────────────

export function createLimiter(ctx: BaseAudioContext): OfflineDeviceNode {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.ratio.value = 20;
    comp.attack.value = 0.001;
    comp.release.value = 0.1;
    comp.knee.value = 0;
    const ceiling = ctx.createGain();
    ceiling.gain.value = 10 ** (-0.3 / 20);
    comp.connect(ceiling);
    return { inputNode: comp, outputNode: ceiling, nodes: [comp, ceiling] };
}
