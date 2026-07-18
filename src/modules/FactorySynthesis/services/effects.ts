import { SAMPLE_RATE } from './constants';

import type { MonoBuffer } from './types';

export function bitcrush(buf: MonoBuffer, bits: number, sampleRateReduction = 1): void {
    const steps = 2 ** (bits - 1);
    let held = 0;
    let counter = 0;
    for (let i = 0; i < buf.length; i++) {
        if (counter <= 0) {
            held = Math.round(buf[i]! * steps) / steps;
            counter = sampleRateReduction;
        }
        buf[i] = held;
        counter--;
    }
}

export function feedbackDelay(
    buf: MonoBuffer,
    delaySec: number,
    feedback: number,
    wetMix: number,
    sampleRate: number = SAMPLE_RATE
): void {
    const delaySamples = Math.max(1, Math.floor(delaySec * sampleRate));
    const line = new Float32Array(delaySamples);
    let writeIdx = 0;
    for (let i = 0; i < buf.length; i++) {
        const delayed = line[writeIdx]!;
        const input = buf[i]!;
        line[writeIdx] = input + delayed * feedback;
        writeIdx = (writeIdx + 1) % delaySamples;
        buf[i] = input * (1 - wetMix) + delayed * wetMix;
    }
}
