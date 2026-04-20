import { type OfflineDeviceNode } from '../types';

// ── LUFS Meter ───────────────────────────────────────────────────────────

export function createLufsMeter(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const kHighShelf = ctx.createBiquadFilter();
    kHighShelf.type = 'highshelf';
    kHighShelf.frequency.value = 1500;
    kHighShelf.gain.value = 4;
    const kHighpass = ctx.createBiquadFilter();
    kHighpass.type = 'highpass';
    kHighpass.frequency.value = 38;
    kHighpass.Q.value = 0.5;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    input.connect(output);
    input.connect(kHighShelf);
    kHighShelf.connect(kHighpass);
    kHighpass.connect(analyser);
    return { inputNode: input, outputNode: output, nodes: [input, output, kHighShelf, kHighpass, analyser] };
}
