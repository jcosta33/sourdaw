import { type OfflineDeviceNode } from '../types';

// ── Delay ────────────────────────────────────────────────────────────────

export function createDelay(ctx: BaseAudioContext): OfflineDeviceNode {
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    const delay = ctx.createDelay(5);
    delay.delayTime.value = 0.25;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.4;
    const fbLowcut = ctx.createBiquadFilter();
    fbLowcut.type = 'highpass';
    fbLowcut.frequency.value = 80;
    fbLowcut.Q.value = 0.7;
    const fbHighcut = ctx.createBiquadFilter();
    fbHighcut.type = 'lowpass';
    fbHighcut.frequency.value = 12000;
    fbHighcut.Q.value = 0.7;
    const splitter = ctx.createGain();
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(delay);
    delay.connect(fbLowcut);
    fbLowcut.connect(fbHighcut);
    fbHighcut.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, delay, feedback, merger, fbLowcut, fbHighcut],
    };
}