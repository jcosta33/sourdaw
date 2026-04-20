import { type OfflineDeviceNode } from '../types';

// ── De-esser ─────────────────────────────────────────────────────────────

export function createDeEsser(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 1;
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'peaking';
    bandpass.frequency.value = 6000;
    bandpass.Q.value = 2;
    bandpass.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 8;
    comp.attack.value = 0.001;
    comp.release.value = 0.05;
    comp.knee.value = 3;
    input.connect(bandpass);
    bandpass.connect(comp);
    comp.connect(output);
    return { inputNode: input, outputNode: output, nodes: [input, output, dry, bandpass, comp] };
}
