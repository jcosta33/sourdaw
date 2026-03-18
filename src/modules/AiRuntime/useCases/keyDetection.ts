import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl-Schmuckler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function detectKey(audioBufferId: string): { key: string; mode: 'major' | 'minor'; confidence: number } | null {
    const buffer = audioBufferCache.get(audioBufferId);
    if (!buffer) {
        return null;
    }

    const sampleRate = buffer.sampleRate;
    const data = buffer.getChannelData(0);

    // Compute chroma features using Goertzel algorithm at specific frequencies
    const chroma = new Float64Array(12);
    const fftSize = 4096;
    const hopSize = 2048;

    for (let frame = 0; frame + fftSize < data.length; frame += hopSize) {
        for (let note = 0; note < 12; note++) {
            for (let octave = 2; octave <= 7; octave++) {
                const freq = 440 * 2 ** ((note - 9 + (octave - 4) * 12) / 12);
                const k = Math.round((freq * fftSize) / sampleRate);
                if (k <= 0 || k >= fftSize / 2) {
                    continue;
                }

                const w = (2 * Math.PI * k) / fftSize;
                const coeff = 2 * Math.cos(w);
                let s0: number,
                    s1 = 0,
                    s2 = 0;

                for (let i = 0; i < fftSize; i++) {
                    s0 = (data[frame + i] ?? 0) + coeff * s1 - s2;
                    s2 = s1;
                    s1 = s0;
                }

                const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
                chroma[note] = chroma[note]! + Math.abs(power);
            }
        }
    }

    const maxChroma = Math.max(...chroma);
    if (maxChroma === 0) {
        return null;
    }
    for (let i = 0; i < 12; i++) {
        chroma[i] = chroma[i]! / maxChroma;
    }

    // Correlate with key profiles
    let bestKey = 0;
    let bestMode: 'major' | 'minor' = 'major';
    let bestCorr = -Infinity;

    for (let shift = 0; shift < 12; shift++) {
        let corrMajor = 0,
            corrMinor = 0;
        for (let i = 0; i < 12; i++) {
            const ci = chroma[(i + shift) % 12]!;
            corrMajor += ci * MAJOR_PROFILE[i]!;
            corrMinor += ci * MINOR_PROFILE[i]!;
        }
        if (corrMajor > bestCorr) {
            bestCorr = corrMajor;
            bestKey = shift;
            bestMode = 'major';
        }
        if (corrMinor > bestCorr) {
            bestCorr = corrMinor;
            bestKey = shift;
            bestMode = 'minor';
        }
    }

    const confidence = Math.min(1, bestCorr / 30);
    return { key: NOTE_NAMES[bestKey]!, mode: bestMode, confidence };
}
