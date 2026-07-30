import { type OfflineDeviceNode } from '../types';

import { createBitcrusherRateDecimator } from './createBitcrusherRateDecimator';
import { makeBitcrusherCurve } from './makeBitcrusherCurve';

/**
 * Graph: the splitter forks into a dry gain and a wet branch of
 * shaper (bit depth) → decimator (rate reduction) → wet gain, recombined at the
 * merger.
 *
 * The decimator is *appended* to `nodes` rather than inserted at its position in
 * the signal flow, so the indices `applyBitcrusherParams` reads stay put whether
 * or not it could be built — see `createBitcrusherRateDecimator` for when it
 * cannot. Quantisation is memoryless, so shaping before holding and holding
 * before shaping produce the same samples; this order simply leaves the shaper
 * where it has always been.
 */
export function createBitcrusher(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeBitcrusherCurve(8);
    shaper.oversample = 'none';
    const merger = ctx.createGain();
    const decimator = createBitcrusherRateDecimator(ctx);
    splitter.connect(dry);
    splitter.connect(shaper);
    if (decimator) {
        shaper.connect(decimator);
        decimator.connect(wet);
    } else {
        shaper.connect(wet);
    }
    dry.connect(merger);
    wet.connect(merger);
    const nodes: AudioNode[] = [splitter, dry, wet, shaper, merger];
    if (decimator) {
        nodes.push(decimator);
    }
    return { inputNode: splitter, outputNode: merger, nodes };
}
