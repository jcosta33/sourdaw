import { describe, it, expect } from 'vitest';

import { chromaFromSamples } from '../chromaFromSamples';

const SAMPLE_RATE = 44100;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function sine(frequency: number, seconds: number): Float32Array {
    const data = new Float32Array(Math.round(SAMPLE_RATE * seconds));
    for (let index = 0; index < data.length; index++) {
        data[index] = Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE);
    }
    return data;
}

function peakPitchClass(chroma: number[]): string {
    let best = 0;
    for (let index = 1; index < chroma.length; index++) {
        if ((chroma[index] ?? 0) > (chroma[best] ?? 0)) {
            best = index;
        }
    }
    return NOTE_NAMES[best] ?? '?';
}

describe('chromaFromSamples', () => {
    it('puts the peak on A for a 440 Hz tone', () => {
        // 440 Hz is A4 by international pitch standard — the expected answer
        // comes from the tuning reference, not from anything in this repo.
        const chroma = chromaFromSamples({ samples: sine(440, 1), sampleRate: SAMPLE_RATE });

        expect(chroma).not.toBeNull();
        expect(peakPitchClass(chroma ?? [])).toBe('A');
    });

    it('puts the peak on E for a 659.25 Hz tone', () => {
        const chroma = chromaFromSamples({ samples: sine(659.255, 1), sampleRate: SAMPLE_RATE });

        expect(peakPitchClass(chroma ?? [])).toBe('E');
    });

    it('tracks the sample rate rather than assuming 44100', () => {
        // The same waveform read at half the sample rate is an octave lower,
        // which is the same pitch class. Reading it at 48 kHz instead is a
        // different frequency and must land on a different pitch class.
        const waveform = sine(440, 1);

        const at44100 = chromaFromSamples({ samples: waveform, sampleRate: 44100 });
        const at22050 = chromaFromSamples({ samples: waveform, sampleRate: 22050 });

        expect(peakPitchClass(at44100 ?? [])).toBe('A');
        expect(peakPitchClass(at22050 ?? [])).toBe('A');
        expect(chromaFromSamples({ samples: waveform, sampleRate: 37044 })).not.toBeNull();
        expect(peakPitchClass(chromaFromSamples({ samples: waveform, sampleRate: 37044 }) ?? [])).not.toBe('A');
    });

    it('normalises the loudest bin to 1 regardless of input gain', () => {
        const quiet = sine(440, 1);
        const loud = new Float32Array(quiet.length);
        for (let index = 0; index < quiet.length; index++) {
            loud[index] = (quiet[index] ?? 0) * 100;
        }

        const quietChroma = chromaFromSamples({ samples: quiet, sampleRate: SAMPLE_RATE }) ?? [];
        const loudChroma = chromaFromSamples({ samples: loud, sampleRate: SAMPLE_RATE }) ?? [];

        expect(Math.max(...quietChroma)).toBeCloseTo(1, 10);
        expect(Math.max(...loudChroma)).toBeCloseTo(1, 10);
        for (const [index, value] of quietChroma.entries()) {
            expect(loudChroma[index]).toBeCloseTo(value, 6);
        }
    });

    it('returns null for silence', () => {
        expect(chromaFromSamples({ samples: new Float32Array(44100), sampleRate: SAMPLE_RATE })).toBeNull();
    });

    it('returns null when the buffer is shorter than one analysis frame', () => {
        expect(chromaFromSamples({ samples: sine(440, 0.05), sampleRate: SAMPLE_RATE })).toBeNull();
    });
});
