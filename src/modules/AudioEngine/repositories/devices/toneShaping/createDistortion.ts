import { type OfflineDeviceNode } from '../types';

import { makeDistortionCurve } from './helpers';

export function createDistortion(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(20);
    shaper.oversample = '4x';
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4000;
    const outputLevel = ctx.createGain();
    outputLevel.gain.value = 1;
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(shaper);
    shaper.connect(tone);
    tone.connect(outputLevel);
    outputLevel.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return { inputNode: splitter, outputNode: merger, nodes: [splitter, dry, wet, shaper, tone, merger, outputLevel] };
}
