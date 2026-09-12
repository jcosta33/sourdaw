import { type OfflineDeviceNode } from '../types';

// ── Chorus ───────────────────────────────────────────────────────────────

/**
 * Descriptor default and ceiling for `chorus-feedback`. The feedback loop is
 * `delay2 -> feedback -> delay2`, so its loop gain equals the knob value:
 * staying strictly below 1 keeps every recirculation contractive and rules
 * out runaway for any value the parameter can hold.
 */
export const CHORUS_FEEDBACK_RANGE = { min: 0, max: 0.9 } as const;
export const DEFAULT_CHORUS_FEEDBACK = 0.2;

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
    const feedback = ctx.createGain();
    feedback.gain.value = DEFAULT_CHORUS_FEEDBACK;
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
    // Recirculation on the second delay line only: one loop, loop gain = the
    // feedback value itself, so the declared 0..0.9 range cannot diverge.
    delay2.connect(feedback);
    feedback.connect(delay2);
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
        nodes: [splitter, dry, wet, delay1, delay2, lfo1, lfo2, lfoGain1, lfoGain2, merger, feedback],
        namedNodes: {
            splitter,
            dry,
            wet,
            delay1,
            delay2,
            lfo1,
            lfo2,
            lfoGain1,
            lfoGain2,
            merger,
            feedback,
        },
        dispose() {
            lfo1.stop();
            lfo2.stop();
        },
    };
}
