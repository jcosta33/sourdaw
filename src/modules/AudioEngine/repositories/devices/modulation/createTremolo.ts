import { type OfflineDeviceNode } from '../types';

// ── Tremolo ──────────────────────────────────────────────────────────────

export function createTremolo(ctx: BaseAudioContext): OfflineDeviceNode {
    const input = ctx.createGain();
    const tremGain = ctx.createGain();
    tremGain.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    lfo.type = 'sine';
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    input.connect(tremGain);
    lfo.connect(lfoDepth);
    lfoDepth.connect(tremGain.gain);
    lfo.start(0);
    return {
        inputNode: input,
        outputNode: tremGain,
        nodes: [input, tremGain, lfo, lfoDepth],
        namedNodes: { input, tremGain, lfo, lfoDepth },
        dispose() {
            lfo.stop();
        },
    };
}
