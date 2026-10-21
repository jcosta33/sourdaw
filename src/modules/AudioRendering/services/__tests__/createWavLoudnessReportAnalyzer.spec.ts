import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createIncrementalMd5 } from '../../repositories/audioEncoders/createIncrementalMd5';
import { audioBufferToWav } from '../../repositories/audioEncoders/wavEncoder';
import { createWavLoudnessReportAnalyzer } from '../createWavLoudnessReportAnalyzer';

import { measureIntegratedLoudness } from '#/utils/audioMetering/measureIntegratedLoudness';
import { measureMaxWindowedLoudness } from '#/utils/audioMetering/measureMaxWindowedLoudness';
import { measureTruePeak } from '#/utils/audioMetering/measureTruePeak';

const source = (rate: number, seconds: number, amplitude = 0.1) => {
    const length = Math.round(rate * seconds);
    const samples = Float32Array.from(
        { length },
        (_, frame) => amplitude * Math.sin((2 * Math.PI * 1000 * frame) / rate)
    );
    return { length, sampleRate: rate, numberOfChannels: 1, getChannelData: () => samples };
};

describe('emitted WAV loudness analysis', () => {
    const shapes: { rate: number; channels: 1 | 2 }[] = [
        { rate: 44100, channels: 1 },
        { rate: 48000, channels: 2 },
        { rate: 88200, channels: 1 },
        { rate: 96000, channels: 2 },
    ];
    it.each(shapes)('accepts actual $rate Hz $channels-channel emitted WAV', async ({ rate, channels }) => {
        const tone = source(rate, 0.41);
        const bytes = new Uint8Array(
            await audioBufferToWav({ ...tone, numberOfChannels: channels }, 24, undefined, { mode: 'none' })
        );
        const first = createWavLoudnessReportAnalyzer(createIncrementalMd5());
        first.write(bytes);
        const second = createWavLoudnessReportAnalyzer(createIncrementalMd5(), first.finish().relativeGatePower);
        second.write(bytes);
        expect(second.finish().wav).toMatchObject({ sampleRate: rate, channels, frames: tone.length });
    });
    const depths: readonly (16 | 24 | 32)[] = [16, 24, 32];
    it.each(depths)('parses every header and sample partition for %i-bit actual output', async (depth) => {
        const bytes = new Uint8Array(await audioBufferToWav(source(48000, 0.41), depth, undefined, { mode: 'none' }));
        const first = createWavLoudnessReportAnalyzer(createIncrementalMd5());
        for (let offset = 0; offset < bytes.length; offset++) first.write(bytes.subarray(offset, offset + 1));
        const threshold = first.finish();
        const second = createWavLoudnessReportAnalyzer(createIncrementalMd5(), threshold.relativeGatePower);
        for (let offset = 0; offset < bytes.length; offset += 17) second.write(bytes.subarray(offset, offset + 17));
        const result = second.finish();
        expect(result.wav).toEqual(threshold.wav);
        expect(result.wav).toMatchObject({
            sampleRate: 48000,
            channels: 1,
            bitDepth: depth,
            frames: 19680,
            bytes: bytes.length,
            md5: createHash('md5').update(bytes).digest('hex'),
        });
        expect(result.integrated).toHaveProperty('value');
        expect(result.maxMomentary).toHaveProperty('value');
        expect(result.maxShortTerm).toEqual({ unavailable: 'short-window', unit: 'LUFS' });
        expect(result.truePeak).toHaveProperty('value');
    });

    it('refuses malformed, truncated and nonfinite actual WAV bytes', async () => {
        const bytes = new Uint8Array(await audioBufferToWav(source(44100, 0.02), 32, undefined, { mode: 'none' }));
        const malformed = bytes.slice();
        malformed[0] = 0;
        expect(() => createWavLoudnessReportAnalyzer(createIncrementalMd5()).write(malformed)).toThrow('Malformed WAV');
        const truncated = createWavLoudnessReportAnalyzer(createIncrementalMd5());
        truncated.write(bytes.subarray(0, bytes.length - 1));
        expect(() => truncated.finish()).toThrow('Incomplete WAV');
        const nonfinite = bytes.slice();
        new DataView(nonfinite.buffer).setFloat32(46, Number.NaN, true);
        expect(() => createWavLoudnessReportAnalyzer(createIncrementalMd5()).write(nonfinite)).toThrow('nonfinite');
    });

    it('distinguishes empty, short and silent meters without numeric zero claims', async () => {
        for (const length of [0, 100, 48000]) {
            const samples = new Float32Array(length);
            const bytes = new Uint8Array(
                await audioBufferToWav(
                    { length, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => samples },
                    16,
                    undefined,
                    { mode: 'none' }
                )
            );
            const first = createWavLoudnessReportAnalyzer(createIncrementalMd5());
            first.write(bytes);
            const second = createWavLoudnessReportAnalyzer(createIncrementalMd5(), first.finish().relativeGatePower);
            second.write(bytes);
            const result = second.finish();
            expect(result.integrated).toHaveProperty('unavailable');
            expect(result.maxMomentary).toHaveProperty('unavailable');
            expect(result.maxShortTerm).toHaveProperty('unavailable');
            expect(result.truePeak).toHaveProperty('unavailable');
        }
    });

    it('matches independent decoded post-clipping float samples, including the true-peak tail', async () => {
        const pcm = source(96000, 3.2, 1.4);
        const bytes = new Uint8Array(await audioBufferToWav(pcm, 32, undefined, { mode: 'none' }));
        const decoded = new Float32Array(pcm.length);
        const view = new DataView(bytes.buffer);
        for (let frame = 0; frame < decoded.length; frame++) decoded[frame] = view.getFloat32(46 + frame * 4, true);
        const first = createWavLoudnessReportAnalyzer(createIncrementalMd5());
        first.write(bytes);
        const second = createWavLoudnessReportAnalyzer(createIncrementalMd5(), first.finish().relativeGatePower);
        second.write(bytes);
        const result = second.finish();
        const expectedI = measureIntegratedLoudness({ channels: [decoded], length: decoded.length, sampleRate: 96000 });
        const expectedPeak = 20 * Math.log10(measureTruePeak({ channels: [decoded], length: decoded.length }));
        expect(result.integrated).toEqual({ value: expectedI, unit: 'LUFS' });
        expect(result.truePeak).toEqual({ value: expectedPeak, unit: 'dBTP' });
        if (!('value' in result.maxMomentary) || !('value' in result.maxShortTerm)) {
            throw new Error('Expected full-length window readings.');
        }
        expect(result.maxMomentary.value).toBeCloseTo(
            measureMaxWindowedLoudness({
                channels: [decoded],
                length: decoded.length,
                sampleRate: 96000,
                windowSeconds: 0.4,
            })!,
            5
        );
        expect(result.maxShortTerm.value).toBeCloseTo(
            measureMaxWindowedLoudness({
                channels: [decoded],
                length: decoded.length,
                sampleRate: 96000,
                windowSeconds: 3,
            })!,
            5
        );
        expect(Math.max(...decoded.subarray(0, 100))).toBeLessThanOrEqual(1);
    });

    it('sign-extends emitted 24-bit negative boundaries and matches negative-only decoded meters', async () => {
        const rate = 48000;
        const samples = Float32Array.from(
            { length: rate },
            (_, frame) => -0.35 + 0.1 * Math.sin((2 * Math.PI * 1000 * frame) / rate)
        );
        samples[0] = -1;
        samples[1] = -1 / 8388608;
        const bytes = new Uint8Array(
            await audioBufferToWav(
                { length: samples.length, sampleRate: rate, numberOfChannels: 1, getChannelData: () => samples },
                24,
                undefined,
                { mode: 'none' }
            )
        );
        expect([...bytes.subarray(44, 50)]).toEqual([0, 0, 128, 255, 255, 255]);

        const decoded = new Float32Array(samples.length);
        for (let frame = 0; frame < decoded.length; frame++) {
            const offset = 44 + frame * 3;
            const raw = bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65536;
            decoded[frame] = (raw >= 8388608 ? raw - 16777216 : raw) / 8388608;
        }
        expect(decoded[0]).toBe(-1);
        expect(decoded[1]).toBe(-1 / 8388608);
        expect(decoded.every((value) => value <= 0)).toBe(true);

        const first = createWavLoudnessReportAnalyzer(createIncrementalMd5());
        first.write(bytes);
        const second = createWavLoudnessReportAnalyzer(createIncrementalMd5(), first.finish().relativeGatePower);
        second.write(bytes);
        const report = second.finish();
        if (!('value' in report.integrated) || !('value' in report.maxMomentary) || !('value' in report.truePeak)) {
            throw new Error('Expected negative-only emitted WAV meters.');
        }
        expect(report.integrated.value).toBeCloseTo(
            measureIntegratedLoudness({ channels: [decoded], length: decoded.length, sampleRate: rate })!,
            5
        );
        expect(report.maxMomentary.value).toBeCloseTo(
            measureMaxWindowedLoudness({
                channels: [decoded],
                length: decoded.length,
                sampleRate: rate,
                windowSeconds: 0.4,
            })!,
            5
        );
        expect(report.truePeak.value).toBeCloseTo(
            20 * Math.log10(measureTruePeak({ channels: [decoded], length: decoded.length })),
            5
        );
    });
});
