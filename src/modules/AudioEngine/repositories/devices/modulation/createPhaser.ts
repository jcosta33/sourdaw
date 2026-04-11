import { type OfflineDeviceNode } from '../types';

// ── Phaser ───────────────────────────────────────────────────────────────

export function createPhaser(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const stages = 4;
    const filters: BiquadFilterNode[] = [];
    for (let i = 0; i < stages; i++) {
        const f = ctx.createBiquadFilter();
        f.type = 'allpass';
        f.frequency.value = 1000 * (i + 1);
        f.Q.value = 0.5;
        filters.push(f);
    }
    for (let i = 0; i < filters.length - 1; i++) {
        filters[i]!.connect(filters[i + 1]!);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.5;
    lfo.type = 'sine';
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 500;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.5;
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(filters[0]!);
    lfo.connect(lfoGain);
    for (const f of filters) {
        lfoGain.connect(f.frequency as unknown as AudioNode);
    }
    const lastFilter = filters[filters.length - 1]!;
    lastFilter.connect(feedback);
    feedback.connect(filters[0]!);
    lastFilter.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    lfo.start(0);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, ...filters, lfo, lfoGain, feedback, dry, wet],
    };
}