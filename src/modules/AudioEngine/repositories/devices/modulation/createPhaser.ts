import { type OfflineDeviceNode } from '../types';

import { PHASER_STAGES_RANGE, wirePhaserStages } from './phaserWiring';

// ── Phaser ───────────────────────────────────────────────────────────────

/** Descriptor default for `phaser-stages`. */
export const DEFAULT_PHASER_STAGES = 4;
/** Shared allpass resonance; deliberately independent of the stage count. */
export const PHASER_ALLPASS_Q = 0.5;

export function createPhaser(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    // Every stage the knob can request is built once, up front; changing the
    // stage count only rewires the chain, it never allocates nodes.
    const filters: BiquadFilterNode[] = [];
    for (let index = 0; index < PHASER_STAGES_RANGE.max; index++) {
        const freq = ctx.createBiquadFilter();
        freq.type = 'allpass';
        freq.frequency.value = 1000 * (index + 1);
        freq.Q.value = PHASER_ALLPASS_Q;
        filters.push(freq);
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
    lfo.connect(lfoGain);
    for (const freq of filters) {
        lfoGain.connect(freq.frequency);
    }
    dry.connect(merger);
    wet.connect(merger);
    lfo.start(0);
    const namedNodes: Record<string, AudioNode> = { splitter, dry, wet, lfo, lfoGain, feedback, merger };
    for (let index = 0; index < filters.length; index++) {
        namedNodes[`filter${index}`] = filters[index]!;
    }
    let disposed = false;
    const dn: OfflineDeviceNode = {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, ...filters, lfo, lfoGain, feedback, merger],
        namedNodes,
        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            lfo.stop();
        },
    };
    wirePhaserStages(dn, DEFAULT_PHASER_STAGES);
    return dn;
}
