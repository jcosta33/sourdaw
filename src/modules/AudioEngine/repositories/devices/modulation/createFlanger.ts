import { type OfflineDeviceNode } from '../types';

// ── Flanger ──────────────────────────────────────────────────────────────

export function createFlanger(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const delay = ctx.createDelay(0.02);
    delay.delayTime.value = 0.005;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.5;
    lfo.type = 'sine';
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.003;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.5;
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(delay);
    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    lfo.start(0);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, delay, lfo, lfoGain, feedback, merger],
        namedNodes: { splitter, dry, wet, delay, lfo, lfoGain, feedback, merger },
        dispose() {
            lfo.stop();
        },
    };
}
