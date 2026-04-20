import { type OfflineDeviceNode } from '../types';

import { makeBitcrusherCurve } from './helpers';

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
    splitter.connect(dry);
    splitter.connect(shaper);
    shaper.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return { inputNode: splitter, outputNode: merger, nodes: [splitter, dry, wet, shaper, merger] };
}
