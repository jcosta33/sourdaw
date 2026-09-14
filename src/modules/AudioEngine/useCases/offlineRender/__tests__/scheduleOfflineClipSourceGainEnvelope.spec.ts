import { describe, expect, it } from 'vitest';

import { projectOfflineAudioClipPlaybacks } from '../projectOfflineAudioClipPlaybacks';
import { scheduleOfflineClipSource } from '../scheduleOfflineClipSource';

import { createNullTestRenderHarness, type HarnessAudioBuffer } from './nullTestRenderHarness';

/**
 * #2865's discriminating test: a bounce of a clip carrying a -12 dB → 0 dB
 * envelope must print the curve, measured as the envelope's own amount
 * between the first and last quarter of the render. Before the fix the
 * offline path never read the envelope at all, so every quarter measured the
 * same flat level and this spec failed on its ratio assertion.
 *
 * The render runs on the null-test harness in `scheduled` automation mode —
 * the one mode whose gain params walk their event timelines per sample, which
 * is the whole question a curve asks of a renderer.
 */

const SAMPLE_RATE = 48_000;
const CLIP_SECONDS = 2;
const FRAMES = SAMPLE_RATE * CLIP_SECONDS;
const SOURCE_LEVEL = 0.5;

function makeConstantBuffer(): HarnessAudioBuffer {
    const left = new Float32Array(FRAMES).fill(SOURCE_LEVEL);
    const right = new Float32Array(FRAMES).fill(SOURCE_LEVEL);
    return {
        sampleRate: SAMPLE_RATE,
        length: FRAMES,
        duration: CLIP_SECONDS,
        numberOfChannels: 2,
        getChannelData: (channel: number) => (channel === 0 ? left : right),
    };
}

/** The envelope's linear amplitude at a destination second, -12 dB → 0 dB. */
function expectedAmplitudeAt(seconds: number): number {
    const dbPerSecond = 12 / CLIP_SECONDS;
    return 10 ** ((-12 + dbPerSecond * seconds) / 20);
}

function rootMeanSquare(samples: Float32Array): number {
    let sum = 0;
    for (let index = 0; index < samples.length; index++) {
        const sample = samples[index]!;
        sum += sample * sample;
    }
    return Math.sqrt(sum / samples.length);
}

async function renderWithEnvelope(
    envelope: ReadonlyArray<{ timeSec: number; gain: number }> | undefined
): Promise<Float32Array> {
    const harness = createNullTestRenderHarness();
    const context = new harness.OfflineAudioContext(2, FRAMES, SAMPLE_RATE, { automation: 'scheduled' });
    scheduleOfflineClipSource({
        context: context as unknown as BaseAudioContext,
        destinationNode: context.destination as unknown as AudioNode,
        buffer: makeConstantBuffer() as unknown as AudioBuffer,
        startSec: 0,
        bufferOffsetSec: 0,
        playDuration: CLIP_SECONDS,
        playbackRate: 1,
        clipGainValue: 1,
        envelope,
        microFadeSeconds: 0.003,
    });
    const rendered = await context.startRendering();
    return rendered.getChannelData(0);
}

describe('scheduleOfflineClipSource applies the clip gain envelope (#2865)', () => {
    it('prints the drawn curve: first-quarter RMS differs from last-quarter RMS by the envelope amount', async () => {
        const rendered = await renderWithEnvelope([
            { timeSec: 0, gain: 10 ** (-12 / 20) },
            { timeSec: CLIP_SECONDS, gain: 10 ** (0 / 20) },
        ]);

        // The measured ratio of the drawn curve's own quarters: the mean of
        // 10^(db/10) over [1.5, 2] s versus [0, 0.5] s under a 6 dB/s rise.
        const firstQuarter = rootMeanSquare(rendered.subarray(0, FRAMES / 4));
        const lastQuarter = rootMeanSquare(rendered.subarray((FRAMES * 3) / 4, FRAMES));
        const expectedRatio = Math.sqrt((10 ** 1.2 - 10 ** 0.9) / (10 ** 0.3 - 1));
        expect(lastQuarter / firstQuarter).toBeCloseTo(expectedRatio, 2);
        // The flat-render failure mode the issue reports: unity throughout.
        expect(lastQuarter / firstQuarter).not.toBeCloseTo(1, 2);
    });

    it('tracks the drawn level pointwise across the render', async () => {
        const rendered = await renderWithEnvelope([
            { timeSec: 0, gain: 10 ** (-12 / 20) },
            { timeSec: CLIP_SECONDS, gain: 10 ** (0 / 20) },
        ]);

        let maxDeviation = 0;
        for (let frame = 0; frame < FRAMES; frame++) {
            const expected = SOURCE_LEVEL * expectedAmplitudeAt(frame / SAMPLE_RATE);
            maxDeviation = Math.max(maxDeviation, Math.abs(rendered[frame]! - expected));
        }
        // Float evaluation of the exponential ramp, not curve error: a flat
        // render deviates from this expectation by ~0.4.
        expect(maxDeviation).toBeLessThan(1e-7);
    });

    it('renders flat at the clip level when no envelope is supplied', async () => {
        const rendered = await renderWithEnvelope(undefined);

        const firstQuarter = rootMeanSquare(rendered.subarray(0, FRAMES / 4));
        const lastQuarter = rootMeanSquare(rendered.subarray((FRAMES * 3) / 4, FRAMES));
        expect(lastQuarter).toBeCloseTo(firstQuarter, 9);
    });
});

describe('projectOfflineAudioClipPlaybacks carries the envelope curve (#2865)', () => {
    const clip = {
        startBeat: 0,
        endBeat: 4,
        loopLength: 4,
        loopEnabled: false,
        stretchMode: 'off',
        stretchRatio: 1,
        gain: 1,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        audioOffsetBeats: 0,
        id: 'clip-1',
    } as const;

    const envelopeSeries = [
        { beatOffset: 0, gainDb: -12 },
        { beatOffset: 4, gainDb: 0 },
    ];

    it('maps the envelope beats onto destination seconds for the reader it is given', () => {
        const playbacks = projectOfflineAudioClipPlaybacks({
            clip,
            bufferDurationSeconds: 100,
            regionStartBeat: 0,
            regionStartSec: 0,
            durationSeconds: 100,
            compensationDelay: 0,
            projectBeatToSeconds: (beat: number) => (beat / 4) * CLIP_SECONDS,
            resolveTempoAtBeat: () => 120,
            readGainEnvelopeSeries: (_clipId: string, spanStartBeats: number, spanEndBeats: number) =>
                spanStartBeats === 0 && spanEndBeats === 4 ? envelopeSeries : undefined,
        });

        expect(playbacks[0]?.envelope).toEqual([
            { timeSec: 0, gain: 10 ** (-12 / 20) },
            { timeSec: CLIP_SECONDS, gain: 1 },
        ]);
    });

    it('emits no envelope for a producer that reads none', () => {
        const playbacks = projectOfflineAudioClipPlaybacks({
            clip,
            bufferDurationSeconds: 100,
            regionStartBeat: 0,
            regionStartSec: 0,
            durationSeconds: 100,
            compensationDelay: 0,
            projectBeatToSeconds: (beat: number) => (beat / 4) * CLIP_SECONDS,
            resolveTempoAtBeat: () => 120,
        });
        expect(playbacks[0]?.envelope).toBeUndefined();
    });
});
