import { type OfflineDeviceNode } from '../types';

import { releaseCompressorAutoMakeup } from './releaseCompressorAutoMakeup';

// ── Compressor ───────────────────────────────────────────────────────────

/**
 * `DynamicsCompressorNode` → auto-makeup trim → user makeup.
 *
 * The trim is unity unless the built-in compressor's Auto Makeup switch is
 * off, when `applyCompressorAutoMakeup` drives it to cancel the gain Chromium
 * adds inside the node. At unity it passes every sample unchanged.
 */
export function createCompressor(ctx: BaseAudioContext): OfflineDeviceNode {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.1;
    comp.knee.value = 6;
    const autoMakeupTrim = ctx.createGain();
    autoMakeupTrim.gain.value = 1;
    const makeup = ctx.createGain();
    makeup.gain.value = 1;
    comp.connect(autoMakeupTrim);
    autoMakeupTrim.connect(makeup);
    return {
        inputNode: comp,
        outputNode: makeup,
        nodes: [comp, makeup, autoMakeupTrim],
        namedNodes: { autoMakeupTrim },
        dispose: () => releaseCompressorAutoMakeup(autoMakeupTrim),
    };
}
