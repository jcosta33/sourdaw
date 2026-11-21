import { dbToGain } from '#/utils/audioLevelLaw';

import { type OfflineDeviceNode } from '../types';

import { makeCeilingClipCurve } from './makeCeilingClipCurve';
import { releaseCompressorAutoMakeup } from './releaseCompressorAutoMakeup';

// ── Limiter ──────────────────────────────────────────────────────────────

/** Descriptor default for `lim-ceiling`. */
export const DEFAULT_LIMITER_CEILING_DB = -0.3;

/**
 * `DynamicsCompressorNode` → auto-makeup trim → ceiling gain → ceiling clip.
 *
 * The compressor alone cannot deliver the advertised peak cap: its gain
 * reduction is gradual (finite attack, 20:1 rather than infinite), so
 * over-level samples still leave it above the ceiling (issue #3736). The
 * WaveShaper after it is the actual cap — its curve never returns a value
 * beyond the selected ceiling, so no sample can, live or offline. The
 * ceiling gain stays the parameter's AudioParam home (threshold trim and the
 * automation binding); the shaper guarantees what the knob advertises.
 *
 * The trim is unity unless the Auto Makeup switch is off, when
 * `applyAutoMakeupSwitch` drives it to cancel the gain Chromium adds inside
 * the node. It sits before the ceiling, so the cap holds either way.
 */
export function createLimiter(ctx: BaseAudioContext): OfflineDeviceNode {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.ratio.value = 20;
    comp.attack.value = 0.001;
    comp.release.value = 0.1;
    comp.knee.value = 0;
    const autoMakeupTrim = ctx.createGain();
    autoMakeupTrim.gain.value = 1;
    const ceiling = ctx.createGain();
    const ceilingGain = dbToGain(DEFAULT_LIMITER_CEILING_DB);
    ceiling.gain.value = ceilingGain;
    const clipper = ctx.createWaveShaper();
    clipper.curve = makeCeilingClipCurve(ceilingGain);
    // Per-sample clipping: oversampling would only soften the exact cap.
    clipper.oversample = 'none';
    comp.connect(autoMakeupTrim);
    autoMakeupTrim.connect(ceiling);
    ceiling.connect(clipper);
    return {
        inputNode: comp,
        outputNode: clipper,
        nodes: [comp, ceiling, clipper, autoMakeupTrim],
        namedNodes: { comp, ceiling, clipper, autoMakeupTrim },
        dispose: () => releaseCompressorAutoMakeup(autoMakeupTrim),
    };
}
