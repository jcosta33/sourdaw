import { type OfflineDeviceNode } from '../types';

// ── AutoPan ──────────────────────────────────────────────────────────────

export function createAutoPan(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const splitterNode = ctx.createChannelSplitter(2);
    const mergerNode = ctx.createChannelMerger(2);
    const leftGain = ctx.createGain();
    leftGain.gain.value = 1;
    const rightGain = ctx.createGain();
    rightGain.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1;
    lfo.type = 'sine';
    const lfoGainL = ctx.createGain();
    lfoGainL.gain.value = 0.5;
    const lfoGainR = ctx.createGain();
    lfoGainR.gain.value = -0.5;
    const output = ctx.createGain();
    output.gain.value = 1;
    input.connect(splitterNode);
    splitterNode.connect(leftGain, 0);
    splitterNode.connect(rightGain, 1);
    lfo.connect(lfoGainL);
    lfo.connect(lfoGainR);
    lfoGainL.connect(leftGain.gain);
    lfoGainR.connect(rightGain.gain);
    leftGain.connect(mergerNode, 0, 0);
    rightGain.connect(mergerNode, 0, 1);
    mergerNode.connect(output);
    lfo.start(0);
    return {
        inputNode: input,
        outputNode: output,
        nodes: [input, splitterNode, mergerNode, leftGain, rightGain, lfo, lfoGainL, lfoGainR, output],
        namedNodes: { input, splitterNode, mergerNode, leftGain, rightGain, lfo, lfoGainL, lfoGainR, output },
        dispose() {
            lfo.stop();
        },
    };
}
