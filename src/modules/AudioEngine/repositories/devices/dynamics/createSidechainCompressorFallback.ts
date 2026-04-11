import { type OfflineDeviceNode } from '../types';

// ── Sidechain compressor fallback ────────────────────────────────────────

export function createSidechainCompressorFallback(ctx: BaseAudioContext): OfflineDeviceNode {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.1;
    const makeup = ctx.createGain();
    makeup.gain.value = 1;
    comp.connect(makeup);
    return { inputNode: comp, outputNode: makeup, nodes: [comp, makeup] };
}