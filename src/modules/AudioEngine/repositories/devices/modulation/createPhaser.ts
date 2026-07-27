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
    for (let index = 0; index < stages; index++) {
        const freq = ctx.createBiquadFilter();
        freq.type = 'allpass';
        freq.frequency.value = 1000 * (index + 1);
        freq.Q.value = 0.5;
        filters.push(freq);
    }
    for (let index = 0; index < filters.length - 1; index++) {
        filters[index]!.connect(filters[index + 1]!);
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
    for (const freq of filters) {
        lfoGain.connect(freq.frequency);
    }
    const lastFilter = filters[filters.length - 1]!;
    lastFilter.connect(feedback);
    feedback.connect(filters[0]!);
    lastFilter.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    lfo.start(0);
    const nodes = [splitter, dry, wet, ...filters, lfo, lfoGain, feedback, merger];
    let disposed = false;
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes,
        namedNodes: {
            splitter,
            dry,
            wet,
            lfo,
            lfoGain,
            feedback,
            merger,
            filter0: filters[0]!,
            filter1: filters[1]!,
            filter2: filters[2]!,
            filter3: filters[3]!,
        },
        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            lfo.stop();
            for (const node of nodes) {
                node.disconnect();
            }
        },
    };
}
