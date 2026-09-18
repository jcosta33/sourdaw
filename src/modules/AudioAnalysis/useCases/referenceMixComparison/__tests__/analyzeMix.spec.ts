import { describe, it, expect } from 'vitest';

import { analyzeMix } from '../analyzeMix/analyzeMix';

type BufferInput = {
    sampleRate?: number;
    length: number;
    channels?: 1 | 2;
    /** Sample generator per channel; defaults to digital silence. */
    sample?: (position: number, channel: number) => number;
};

function createBuffer(input: BufferInput): AudioBuffer {
    const sampleRate = input.sampleRate ?? 48_000;
    const channels = input.channels ?? 1;
    const channelData = Array.from({ length: channels }, (_, channel) => {
        const data = new Float32Array(input.length);
        for (let position = 0; position < input.length; position++) {
            data[position] = input.sample?.(position, channel) ?? 0;
        }
        return data;
    });
    return {
        sampleRate,
        length: input.length,
        numberOfChannels: channels,
        getChannelData: (channel: number) => channelData[channel] ?? channelData[0]!,
        duration: input.length / sampleRate,
    } as unknown as AudioBuffer;
}

const sineAt =
    (frequencyHz: number, amplitude = 0.5, sampleRate = 48_000) =>
    (position: number) =>
        amplitude * Math.sin((2 * Math.PI * frequencyHz * position) / sampleRate);

describe('reference mix analyzeMix — program-audio measurement', () => {
    it('reports unavailable when no program audio was supplied', () => {
        expect(analyzeMix()).toEqual({ status: 'unavailable', reason: 'no-program-audio' });
        expect(analyzeMix([])).toEqual({ status: 'unavailable', reason: 'no-program-audio' });
    });

    it('reports unavailable instead of numbers for a silent source', () => {
        const silence = createBuffer({ length: 48_000 });
        expect(analyzeMix([silence])).toEqual({ status: 'unavailable', reason: 'silent-program-audio' });
    });

    it('measures levels, crest, and band energy from real samples', () => {
        // One second of a 220 Hz sine at 0.5 amplitude: a bass-band tone.
        const program = createBuffer({ length: 48_000, sample: sineAt(220) });

        const result = analyzeMix([program]);

        if (result.status !== 'measured') {
            throw new Error('Expected a measured result');
        }
        expect(result.source).toBe('program-audio');
        // 20·log10(0.5) and the sine's RMS 20·log10(0.5/√2).
        expect(result.analysis.peakDb).toBeCloseTo(-6.0206, 3);
        expect(result.analysis.rmsDb).toBeCloseTo(-9.0309, 3);
        expect(result.analysis.crestFactor).toBeCloseTo(3.0103, 3);
        // A single 220 Hz tone concentrates its spectral energy in the bass band.
        expect(result.analysis.frequencyProfile.bass).toBeGreaterThan(0.5);
    });

    it('changes the measurement when the audio content changes, not the layout', () => {
        const bassTone = analyzeMix([createBuffer({ length: 48_000, sample: sineAt(80) })]);
        const midTone = analyzeMix([createBuffer({ length: 48_000, sample: sineAt(1000) })]);

        if (bassTone.status !== 'measured' || midTone.status !== 'measured') {
            throw new Error('Expected measured results');
        }
        // Same "layout" (one loud full-scale track), different sound →
        // different frequency profile.
        expect(bassTone.analysis.frequencyProfile.bass).toBeGreaterThan(0.5);
        expect(midTone.analysis.frequencyProfile.mid).toBeGreaterThan(0.5);
        expect(midTone.analysis.frequencyProfile.bass).toBeLessThan(0.1);
    });

    it('does not invent narrower dynamics when the same sound spans more buffers', () => {
        const oneTrack = analyzeMix([createBuffer({ length: 48_000, sample: sineAt(220) })]);
        const sameSoundSplit = analyzeMix([
            createBuffer({ length: 48_000, sample: sineAt(220) }),
            createBuffer({ length: 48_000, sample: sineAt(220) }),
        ]);

        if (oneTrack.status !== 'measured' || sameSoundSplit.status !== 'measured') {
            throw new Error('Expected measured results');
        }
        expect(sameSoundSplit.analysis.dynamicRange).toBeCloseTo(oneTrack.analysis.dynamicRange, 6);
        expect(oneTrack.analysis.dynamicRange).toBeGreaterThan(0);
    });

    it('derives stereo width from interchannel content instead of pan metadata', () => {
        // Duplicated mono: perfectly correlated channels → zero width.
        const duplicatedMono = analyzeMix([createBuffer({ length: 48_000, channels: 2, sample: sineAt(220) })]);
        // Phase-inverted channels: perfectly anti-correlated → maximum width.
        const inverted = analyzeMix([
            createBuffer({
                length: 48_000,
                channels: 2,
                sample: (position, channel) => sineAt(220)(position) * (channel === 0 ? 1 : -1),
            }),
        ]);

        if (duplicatedMono.status !== 'measured' || inverted.status !== 'measured') {
            throw new Error('Expected measured results');
        }
        expect(duplicatedMono.analysis.stereoWidth).toBeCloseTo(0, 6);
        expect(inverted.analysis.stereoWidth).toBeCloseTo(1, 6);
    });
});
