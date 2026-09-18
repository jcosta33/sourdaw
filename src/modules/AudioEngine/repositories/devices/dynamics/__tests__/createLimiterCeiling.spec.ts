import { describe, expect, it } from 'vitest';

import { dbToGain } from '#/utils/audioLevelLaw';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { applyLimiterParams } from '../applyLimiterParams';
import { createLimiter, DEFAULT_LIMITER_CEILING_DB } from '../createLimiter';
import { CEILING_CLIP_CURVE_SAMPLES, makeCeilingClipCurve } from '../makeCeilingClipCurve';

/**
 * The WaveShaper transfer the platform documents: inputs outside the curve
 * domain clamp to the endpoint samples, inputs inside interpolate linearly
 * between neighbours. This is the oracle the #3736 repro rides — a hot
 * sample's only route through the cap is this function.
 */
function applyWaveShaperCurve(curve: Float32Array, input: number): number {
    if (input <= -1) {
        return curve[0]!;
    }
    if (input >= 1) {
        return curve[curve.length - 1]!;
    }
    const position = ((input + 1) / 2) * (curve.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const blend = position - lower;
    return curve[lower]! * (1 - blend) + curve[upper]! * blend;
}

function shaperCurve(device: ReturnType<typeof createLimiter>): Float32Array {
    const curve = (device.nodes[2] as unknown as { curve: Float32Array | null }).curve;
    if (!curve) {
        throw new Error('expected the limiter clipper to carry a curve');
    }
    return curve;
}

/** One float32 ULP near unity, plus slack: the curve stores float32 samples. */
const FLOAT32_TOLERANCE = 2e-7;

function sweepSineSamples(amplitude: number, cycles: number): number[] {
    const samples: number[] = [];
    const totalSamples = 480;
    for (let index = 0; index < totalSamples; index++) {
        samples.push(amplitude * Math.sin((2 * Math.PI * cycles * index) / totalSamples));
    }
    return samples;
}

describe('createLimiter ceiling cap (#3736)', () => {
    it('builds the clipper after the ceiling gain, with a curve and no oversampling', () => {
        const device = createLimiter(asBaseAudioContext(createMockAudioContext()));
        expect(device.nodes).toHaveLength(3);
        const ceiling = device.nodes[1] as GainNode;
        const clipper = device.nodes[2] as unknown as { oversample: string };
        expect(ceiling.gain.value).toBeCloseTo(dbToGain(DEFAULT_LIMITER_CEILING_DB), 12);
        expect((ceiling as unknown as { connectedTo: unknown[] }).connectedTo).toContain(device.nodes[2]);
        expect(shaperCurve(device).length).toBe(CEILING_CLIP_CURVE_SAMPLES);
        expect(clipper.oversample).toBe('none');
        expect(device.outputNode).toBe(device.nodes[2]);
    });

    it('never returns a value beyond the selected ceiling, anywhere on the curve', () => {
        const device = createLimiter(asBaseAudioContext(createMockAudioContext()));
        const ceilingGain = dbToGain(DEFAULT_LIMITER_CEILING_DB);
        const curve = shaperCurve(device);
        // The curve is Float32 — Chromium's render quantum — so every bound
        // carries one float32 ULP of tolerance, not float64 exactness.
        for (const value of curve) {
            expect(Math.abs(value)).toBeLessThanOrEqual(ceilingGain + FLOAT32_TOLERANCE);
        }
        // The endpoints are where WaveShaper sends everything past full
        // scale: they must sit on the ceiling for hot inputs.
        expect(curve[0]).toBeCloseTo(-ceilingGain, 6);
        expect(curve[curve.length - 1]).toBeCloseTo(ceilingGain, 6);
        // And the transfer of anything, anywhere, stays under the cap.
        for (let input = -4; input <= 4; input += 0.0005) {
            expect(Math.abs(applyWaveShaperCurve(curve, input))).toBeLessThanOrEqual(ceilingGain + FLOAT32_TOLERANCE);
        }
    });

    it('caps the #3736 repro signal (1 kHz sine, amplitude 4) at the selected ceiling', () => {
        const device = createLimiter(asBaseAudioContext(createMockAudioContext()));
        const ceilingGain = dbToGain(DEFAULT_LIMITER_CEILING_DB);
        const curve = shaperCurve(device);
        const capped = sweepSineSamples(4, 8).map((sample) => applyWaveShaperCurve(curve, sample));
        const peak = Math.max(...capped.map(Math.abs));
        // The advertised cap holds for sustained over-level input — before
        // the fix this signal rendered peaks of ~1.059 against a 0.966
        // ceiling — and it holds *at* the ceiling, not below it: the device
        // limits, it does not just attenuate.
        expect(peak).toBeLessThanOrEqual(ceilingGain + FLOAT32_TOLERANCE);
        expect(peak).toBeGreaterThan(ceilingGain - 1e-3);
    });

    it('stays transparent for material the ceiling admits', () => {
        const device = createLimiter(asBaseAudioContext(createMockAudioContext()));
        const curve = shaperCurve(device);
        // Identity within half the curve lattice spacing; the curve is
        // deliberately dense so the pass band never audibly deviates.
        expect(applyWaveShaperCurve(curve, 0.2)).toBeCloseTo(0.2, 4);
        expect(applyWaveShaperCurve(curve, -0.7)).toBeCloseTo(-0.7, 4);
        expect(applyWaveShaperCurve(curve, dbToGain(DEFAULT_LIMITER_CEILING_DB) - 0.01)).toBeCloseTo(
            dbToGain(DEFAULT_LIMITER_CEILING_DB) - 0.01,
            4
        );
    });

    it('moves the cap when the ceiling parameter is applied', () => {
        const device = createLimiter(asBaseAudioContext(createMockAudioContext()));
        applyLimiterParams(device, { 'lim-ceiling': -3 });
        const ceilingGain = dbToGain(-3);
        expect((device.nodes[1] as GainNode).gain.value).toBeCloseTo(ceilingGain, 12);
        const curve = shaperCurve(device);
        expect(curve[curve.length - 1]).toBeCloseTo(ceilingGain, 6);
        const capped = sweepSineSamples(4, 8).map((sample) => applyWaveShaperCurve(curve, sample));
        expect(Math.max(...capped.map(Math.abs))).toBeLessThanOrEqual(ceilingGain + FLOAT32_TOLERANCE);
    });

    it('matches the shared curve builder when the ceiling moves', () => {
        const device = createLimiter(asBaseAudioContext(createMockAudioContext()));
        applyLimiterParams(device, { 'lim-ceiling': -1.5 });
        expect(shaperCurve(device)).toEqual(makeCeilingClipCurve(dbToGain(-1.5)));
    });
});
