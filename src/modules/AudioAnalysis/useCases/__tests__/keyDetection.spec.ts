import { describe, it, expect, vi, beforeEach } from 'vitest';

const SAMPLE_RATE = 44100;

function mulberry32(seed: number): () => number {
    let state = seed;
    return function next() {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function midiToHz(midi: number): number {
    return 440 * 2 ** ((midi - 69) / 12);
}

/** Render a chord sequence as summed sines. MIDI numbers, 60 = middle C. */
function renderChords(chords: number[][], secondsPerChord = 0.6): Float32Array {
    const perChord = Math.round(SAMPLE_RATE * secondsPerChord);
    const data = new Float32Array(perChord * chords.length);
    for (const [chordIndex, chord] of chords.entries()) {
        for (let index = 0; index < perChord; index++) {
            let value = 0;
            for (const midi of chord) {
                value += Math.sin((2 * Math.PI * midiToHz(midi) * index) / SAMPLE_RATE);
            }
            data[chordIndex * perChord + index] = value / chord.length;
        }
    }
    return data;
}

function whiteNoise(seed: number, seconds: number): Float32Array {
    const random = mulberry32(seed);
    const data = new Float32Array(Math.round(SAMPLE_RATE * seconds));
    for (let index = 0; index < data.length; index++) {
        data[index] = random() * 2 - 1;
    }
    return data;
}

function mixIn(signal: Float32Array, noiseGain: number, seed: number): Float32Array {
    const noise = whiteNoise(seed, signal.length / SAMPLE_RATE);
    const out = new Float32Array(signal.length);
    for (let index = 0; index < signal.length; index++) {
        out[index] = (signal[index] ?? 0) + (noise[index] ?? 0) * noiseGain;
    }
    return out;
}

function buffer(
    samples: Float32Array,
    sampleRate = SAMPLE_RATE
): { sampleRate: number; getChannelData: () => Float32Array } {
    return { sampleRate, getChannelData: () => samples };
}

// I-IV-V-I in C major. The B naturals and the G major triad exclude A minor.
const C_MAJOR_CADENCE = renderChords([
    [60, 64, 67],
    [65, 69, 72],
    [67, 71, 74],
    [60, 64, 67],
]);

// i-iv-V-i in A minor. The G# leading tone in the V chord excludes C major.
const A_MINOR_CADENCE = renderChords([
    [57, 60, 64],
    [62, 65, 69],
    [64, 68, 71],
    [57, 60, 64],
]);

// I-IV-V-I transposed up five semitones: F major. Same construction, different
// answer, so a detector that has memorised C cannot pass both.
const F_MAJOR_CADENCE = renderChords([
    [65, 69, 72],
    [70, 74, 77],
    [72, 76, 79],
    [65, 69, 72],
]);

const BUFFERS: Record<string, { sampleRate: number; getChannelData: () => Float32Array }> = {
    silent: buffer(new Float32Array(44100)),
    noise: buffer(whiteNoise(0xc0ffee, 2)),
    'noise-short': buffer(whiteNoise(0x5150, 0.4)),
    'noise-other-seed': buffer(whiteNoise(0xbeef, 2)),
    'chromatic-aggregate': buffer(renderChords([[60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]], 2)),
    'c-major': buffer(C_MAJOR_CADENCE),
    'a-minor': buffer(A_MINOR_CADENCE),
    'f-major': buffer(F_MAJOR_CADENCE),
    'c-major-under-noise': buffer(mixIn(C_MAJOR_CADENCE, 3, 0x99)),
    'c-major-drowned': buffer(mixIn(C_MAJOR_CADENCE, 10, 0x99)),
    'a3-sine': buffer(renderChords([[57]], 2)),
    'c-major-scale': buffer(renderChords([[60], [62], [64], [65], [67], [69], [71], [72]], 0.3)),
};

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: vi.fn(({ bufferId }: { bufferId: string }) => BUFFERS[bufferId] ?? null),
}));

import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { detectKey } from '../keyDetection';

function label(result: ReturnType<typeof detectKey>): string {
    if (!result) {
        return 'null';
    }
    if (!result.detected) {
        return 'no key';
    }
    return `${result.key} ${result.mode}`;
}

describe('detectKey', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('reports no key for white noise instead of naming one', () => {
        // The shipped detector answered this with a named minor key at 100%
        // confidence, because min(1, dotProduct / 30) saturates on broadband
        // material. Noise has no key; anything other than "no key" here is the
        // bug.
        const result = detectKey('noise');

        expect(result).toEqual({ detected: false });
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'noise' });
    });

    it('reports no key for noise at other seeds and durations', () => {
        expect(detectKey('noise-other-seed')).toEqual({ detected: false });
        expect(detectKey('noise-short')).toEqual({ detected: false });
    });

    it('reports no key for a full chromatic aggregate', () => {
        // All twelve pitch classes sounding equally is atonal by construction,
        // and unlike noise it is a perfectly pitched signal — so this fails any
        // detector that only looks for "is it noisy".
        expect(detectKey('chromatic-aggregate')).toEqual({ detected: false });
    });

    it('reads a I-IV-V-I cadence in C major as C major', () => {
        expect(label(detectKey('c-major'))).toBe('C major');
    });

    it('reads a i-iv-V-i cadence in A minor as A minor', () => {
        // Same seven pitch classes as C major apart from the G# leading tone.
        // The un-centred detector resolves this one too — which is exactly why
        // it cannot be the only fixture.
        expect(label(detectKey('a-minor'))).toBe('A minor');
    });

    it('follows a transposition of the same cadence to F major', () => {
        expect(label(detectKey('f-major'))).toBe('F major');
    });

    it('still resolves the key when the music is buried under louder noise', () => {
        expect(label(detectKey('c-major-under-noise'))).toBe('C major');
    });

    it('gives up rather than guess once the noise has swamped the music', () => {
        // At ten times the amplitude of the music the un-gated correlation
        // still returns a key, and returns the wrong one (E minor).
        expect(detectKey('c-major-drowned')).toEqual({ detected: false });
    });

    it('reports the relative major as a close call on a bare diatonic scale', () => {
        // A C major scale with no tonic weighting is genuinely ambiguous
        // between C major and A minor — the confusion MIREX scores at 0.3.
        // Reporting one of them silently is a lie about how much was measured.
        const result = detectKey('c-major-scale');

        if (result?.detected !== true || !result.alternative) {
            throw new Error(`expected a close call, got ${label(result)}`);
        }

        const pair = [`${result.key} ${result.mode}`, `${result.alternative.key} ${result.alternative.mode}`].sort();
        expect(pair).toEqual(['A minor', 'C major']);
    });

    it('flags a single sustained sine as undecided between its major and minor key', () => {
        // One pitch class cannot imply a mode. The shipped detector called
        // this "A minor" at 25% confidence with no hint of the tie.
        const result = detectKey('a3-sine');
        const reading = result?.detected === true ? result : null;

        expect(reading?.key).toBe('A');
        expect(reading?.alternative?.key).toBe('A');
        expect(reading?.alternative?.mode).not.toBe(reading?.mode);
    });

    it('does not flag an unambiguous cadence as a close call', () => {
        const result = detectKey('c-major');
        const reading = result?.detected === true ? result : null;

        expect(reading?.alternative).toBeUndefined();
    });

    it('scores a clear cadence far above the level broadband material reaches', () => {
        const result = detectKey('c-major');
        const reading = result?.detected === true ? result : null;

        expect(reading?.confidence).toBeGreaterThan(0.85);
        // A correlation coefficient, not a saturating magnitude: real audio
        // never matches a probe-tone profile exactly.
        expect(reading?.confidence).toBeLessThan(1);
    });

    it('reports lower confidence for degraded material than for the clean take', () => {
        const clean = detectKey('c-major');
        const degraded = detectKey('c-major-under-noise');
        const cleanConfidence = clean?.detected === true ? clean.confidence : Number.NaN;
        const degradedConfidence = degraded?.detected === true ? degraded.confidence : Number.NaN;

        expect(degradedConfidence).toBeLessThan(cleanConfidence);
        expect(degradedConfidence).toBeGreaterThan(0.5);
    });

    it('returns null when the audio buffer is missing', () => {
        expect(detectKey('missing')).toBeNull();
        expect(getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'missing' });
    });

    it('returns null for silence, distinct from the atonal answer', () => {
        expect(detectKey('silent')).toBeNull();
    });
});
