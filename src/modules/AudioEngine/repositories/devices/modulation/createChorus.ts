import { type OfflineDeviceNode } from '../types';

// ── Chorus ───────────────────────────────────────────────────────────────

export function createChorus(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    const delay1 = ctx.createDelay(0.05);
    delay1.delayTime.value = 0.02;
    const delay2 = ctx.createDelay(0.05);
    delay2.delayTime.value = 0.025;
    const lfo1 = ctx.createOscillator();
    lfo1.frequency.value = 0.5;
    lfo1.type = 'sine';
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.6;
    lfo2.type = 'sine';
    const lfoGain1 = ctx.createGain();
    lfoGain1.gain.value = 0.005;
    const lfoGain2 = ctx.createGain();
    lfoGain2.gain.value = 0.005;
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(delay1);
    splitter.connect(delay2);
    lfo1.connect(lfoGain1);
    lfoGain1.connect(delay1.delayTime);
    lfo2.connect(lfoGain2);
    lfoGain2.connect(delay2.delayTime);
    delay1.connect(wet);
    delay2.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    lfo1.start(0);
    lfo2.start(0);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, delay1, delay2, lfo1, lfo2, lfoGain1, lfoGain2, merger],
        namedNodes: { splitter, dry, wet, delay1, delay2, lfo1, lfo2, lfoGain1, lfoGain2, merger },
        dispose() {
            lfo1.stop();
            lfo2.stop();
        },
    };
}
