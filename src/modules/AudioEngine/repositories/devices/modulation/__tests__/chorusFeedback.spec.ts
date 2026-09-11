import { describe, expect, it } from 'vitest';

import {
    asBaseAudioContext,
    createMockAudioContext,
    type MockAudioContext,
} from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyChorusParams } from '../applyChorusParams';
import { createChorus } from '../createChorus';

/**
 * Issue #3732 oracle: `chorus-feedback` was declared, default 0.2, but the
 * factory had two feed-forward delays and no feedback path, so renders at 0
 * and 0.9 nulled exactly. These tests require a real recirculating loop in the
 * graph the factory builds, with the knob's value driving it — and require the
 * loop to stay contractive instead of running away.
 *
 * The render walks the difference equation of the graph as built: `delay2`'s
 * input is the dry signal plus `feedback` times `delay2`'s own delayed output,
 * with both delay lengths and the feedback gain read back from the graph's
 * nodes. If the loop or the write is removed, the two renders null again and
 * the spec fails.
 */

const SAMPLE_RATE = 48_000;

function makeDevice() {
    const ctx: MockAudioContext = createMockAudioContext();
    return createChorus(asBaseAudioContext(ctx));
}

/** Render the wet path of the built graph for `input`, reading node values. */
function renderWetPath(device: ReturnType<typeof createChorus>, input: Float32Array): Float32Array {
    const delay1 = device.namedNodes!.delay1 as DelayNode;
    const delay2 = device.namedNodes!.delay2 as DelayNode;
    const feedback = device.namedNodes!.feedback as GainNode;
    const wet = device.namedNodes!.wet as GainNode;
    const dry = device.namedNodes!.dry as GainNode;

    const d1 = Math.round(SAMPLE_RATE * delay1.delayTime.value);
    const d2 = Math.round(SAMPLE_RATE * delay2.delayTime.value);
    const fb = feedback.gain.value;

    const y1 = new Float32Array(input.length);
    const y2 = new Float32Array(input.length);
    for (let index = 0; index < input.length; index++) {
        // delay1 is feed-forward; delay2 recirculates through the feedback gain.
        y1[index] = input[index - d1] ?? 0;
        const recirculated = y2[index - d2] ?? 0;
        y2[index] = (input[index - d2] ?? 0) + fb * recirculated;
    }
    const output = new Float32Array(input.length);
    for (let index = 0; index < input.length; index++) {
        output[index] = dry.gain.value * input[index]! + wet.gain.value * (y1[index]! + y2[index]!);
    }
    return output;
}

function sustainedThenSilence(): Float32Array {
    const total = new Float32Array(SAMPLE_RATE);
    for (let index = 0; index < SAMPLE_RATE / 4; index++) {
        total[index] = Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE);
    }
    return total;
}

describe('chorus feedback path (#3732)', () => {
    it('routes a feedback loop around delay2 in the built graph', () => {
        const device = makeDevice();
        const delay2 = device.namedNodes!.delay2 as unknown as { connectedTo: unknown[] };
        const feedback = device.namedNodes!.feedback as unknown as { connectedTo: unknown[] };

        expect(delay2.connectedTo).toContain(device.namedNodes!.feedback);
        expect(feedback.connectedTo).toContain(device.namedNodes!.delay2);
    });

    it('writes chorus-feedback onto the loop gain and holds the declared 0..0.9 window', () => {
        const device = makeDevice();
        const feedback = device.namedNodes!.feedback as GainNode;

        applyChorusParams(device, { 'chorus-feedback': 0.7 });
        expect(feedback.gain.value).toBe(0.7);

        applyChorusParams(device, { 'chorus-feedback': 5 });
        expect(feedback.gain.value).toBe(0.9);

        applyChorusParams(device, { 'chorus-feedback': -2 });
        expect(feedback.gain.value).toBe(0);
    });

    it('renders 0 and 0.9 feedback differently, with a decaying and bounded tail', () => {
        const input = sustainedThenSilence();

        const silent = makeDevice();
        applyChorusParams(silent, { 'chorus-feedback': 0 });
        const silentRender = renderWetPath(silent, input);

        const hot = makeDevice();
        applyChorusParams(hot, { 'chorus-feedback': 0.9 });
        const hotRender = renderWetPath(hot, input);

        // The renders must differ: with no loop the wet output dies with the
        // input; with 0.9 the tail keeps recirculating.
        const maxDelta = silentRender.reduce(
            (max, sample, index) => Math.max(max, Math.abs(sample - hotRender[index]!)),
            0
        );
        expect(maxDelta).toBeGreaterThan(0);

        const afterInput = Math.round(SAMPLE_RATE * 0.3);
        const silentTailPeak = silentRender
            .slice(afterInput)
            .reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
        const hotTailPeak = hotRender.slice(afterInput).reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
        expect(silentTailPeak).toBe(0);
        expect(hotTailPeak).toBeGreaterThan(0.01);

        // Loop gain 0.9 < 1: the tail must decay monotonically in energy, never
        // build up — the guard that keeps the knob off runaway.
        const latePeak = hotRender
            .slice(Math.round(SAMPLE_RATE * 0.8))
            .reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
        expect(latePeak).toBeLessThan(hotTailPeak);
        expect(Array.from(hotRender).every(Number.isFinite)).toBe(true);
    });
});
