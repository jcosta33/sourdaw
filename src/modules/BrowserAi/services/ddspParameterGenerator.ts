/**
 * Service: Generate DDSP synthesis parameters from MIDI input.
 *
 * Produces harmonic distribution, amplitude, and noise magnitude parameters
 * for each instrument type using handcrafted spectral profiles. This serves
 * as the built-in parameter source — no ML model download required.
 *
 * Each instrument has a characteristic harmonic spectrum based on acoustic
 * research (e.g., violin emphasizes odd harmonics, flute has a strong
 * fundamental with rapid harmonic rolloff). Parameters vary with pitch
 * and loudness for realistic timbre shifts.
 *
 * When/if an ONNX model is available, it can replace this generator for
 * higher-quality results. The DSP synthesizer (ddspSynthesizer.ts) is
 * the same either way.
 */

const N_HARMONICS = 60;
const N_NOISE_BANDS = 65;

type InstrumentProfile = {
    /** Harmonic amplitude rolloff exponent (higher = faster decay) */
    rolloff: number;
    /** Odd harmonic emphasis (1.0 = no emphasis, >1.0 = boost odds) */
    oddEmphasis: number;
    /** Noise floor level (0-1, how much filtered noise relative to harmonics) */
    noiseLevel: number;
    /** Noise spectral tilt (positive = more high-freq noise) */
    noiseTilt: number;
    /** Brightness shift with pitch (how much harmonics brighten at high pitches) */
    brightnessTracking: number;
};

/**
 * Spectral profiles for each instrument, indexed by instrument_id.
 * Based on acoustic analysis of orchestral instruments.
 */
const INSTRUMENT_PROFILES: InstrumentProfile[] = [
    /* 0  Violin    */ { rolloff: 1.0, oddEmphasis: 1.4, noiseLevel: 0.03, noiseTilt: 0.3, brightnessTracking: 0.5 },
    /* 1  Viola     */ { rolloff: 1.1, oddEmphasis: 1.3, noiseLevel: 0.04, noiseTilt: 0.2, brightnessTracking: 0.4 },
    /* 2  Cello     */ { rolloff: 0.9, oddEmphasis: 1.3, noiseLevel: 0.04, noiseTilt: 0.1, brightnessTracking: 0.3 },
    /* 3  Bass      */ { rolloff: 0.8, oddEmphasis: 1.2, noiseLevel: 0.05, noiseTilt: 0.0, brightnessTracking: 0.2 },
    /* 4  Flute     */ { rolloff: 2.5, oddEmphasis: 1.0, noiseLevel: 0.10, noiseTilt: 0.6, brightnessTracking: 0.8 },
    /* 5  Oboe      */ { rolloff: 0.7, oddEmphasis: 1.1, noiseLevel: 0.02, noiseTilt: 0.4, brightnessTracking: 0.6 },
    /* 6  Clarinet  */ { rolloff: 1.2, oddEmphasis: 2.0, noiseLevel: 0.03, noiseTilt: 0.3, brightnessTracking: 0.5 },
    /* 7  Saxophone */ { rolloff: 0.8, oddEmphasis: 1.1, noiseLevel: 0.06, noiseTilt: 0.3, brightnessTracking: 0.4 },
    /* 8  Bassoon   */ { rolloff: 0.7, oddEmphasis: 1.2, noiseLevel: 0.04, noiseTilt: 0.1, brightnessTracking: 0.3 },
    /* 9  Trumpet   */ { rolloff: 0.5, oddEmphasis: 1.0, noiseLevel: 0.02, noiseTilt: 0.5, brightnessTracking: 0.7 },
    /* 10 Horn      */ { rolloff: 0.9, oddEmphasis: 1.0, noiseLevel: 0.03, noiseTilt: 0.2, brightnessTracking: 0.4 },
    /* 11 Trombone  */ { rolloff: 0.6, oddEmphasis: 1.0, noiseLevel: 0.03, noiseTilt: 0.3, brightnessTracking: 0.5 },
    /* 12 Tuba      */ { rolloff: 0.7, oddEmphasis: 1.0, noiseLevel: 0.05, noiseTilt: 0.0, brightnessTracking: 0.2 },
];

type GenerateParamsInput = {
    /** Per-frame pitch in Hz, shape [nFrames] */
    f0Hz: Float32Array;
    /** Per-frame loudness in dB, shape [nFrames] */
    loudnessDb: Float32Array;
    /** Instrument index (0-12) */
    instrumentId: number;
    nFrames: number;
};

type GenerateParamsOutput = {
    amplitudes: Float32Array;
    harmonicDistribution: Float32Array;
    noiseMagnitudes: Float32Array;
};

/**
 * Generate DDSP synthesis parameters from MIDI pitch/loudness and instrument profile.
 */
export function generateDdspParams({
    f0Hz,
    loudnessDb,
    instrumentId,
    nFrames,
}: GenerateParamsInput): GenerateParamsOutput {
    const profile = INSTRUMENT_PROFILES[instrumentId] ?? INSTRUMENT_PROFILES[0]!;

    const amplitudes = new Float32Array(nFrames);
    const harmonicDistribution = new Float32Array(nFrames * N_HARMONICS);
    const noiseMagnitudes = new Float32Array(nFrames * N_NOISE_BANDS);

    for (let frame = 0; frame < nFrames; frame++) {
        const f0 = f0Hz[frame]!;
        const db = loudnessDb[frame]!;

        // Convert dB to linear amplitude (dB range: -120 to 0)
        const amp = db > -120 ? Math.pow(10, db / 20) : 0;
        amplitudes[frame] = amp;

        if (amp < 1e-6) {
            // Silent frame — leave harmonics and noise as zeros
            continue;
        }

        // Pitch-dependent brightness: higher notes have brighter harmonics
        const pitchFactor = f0 > 0 ? Math.log2(f0 / 220) : 0; // 0 at A3, 1 at A4, etc.
        const brightnessBoost = 1 + profile.brightnessTracking * Math.max(0, pitchFactor);

        // Generate harmonic distribution
        const offset = frame * N_HARMONICS;
        let harmonicSum = 0;
        for (let k = 0; k < N_HARMONICS; k++) {
            const harmonic = k + 1;
            // Base rolloff: amplitude decreases with harmonic number
            let h = 1 / Math.pow(harmonic, profile.rolloff / brightnessBoost);
            // Odd harmonic emphasis (important for strings and clarinet)
            if (harmonic % 2 === 1) {
                h *= profile.oddEmphasis;
            }
            harmonicDistribution[offset + k] = h;
            harmonicSum += h;
        }
        // Normalize to sum to 1 (distribution, not absolute amplitudes)
        if (harmonicSum > 0) {
            for (let k = 0; k < N_HARMONICS; k++) {
                harmonicDistribution[offset + k]! /= harmonicSum;
            }
        }

        // Generate noise magnitude spectrum
        const noiseOffset = frame * N_NOISE_BANDS;
        for (let b = 0; b < N_NOISE_BANDS; b++) {
            const freq = b / (N_NOISE_BANDS - 1); // 0 (low) to 1 (high)
            // Spectral tilt: positive tilt = more high-frequency noise
            const tilt = Math.pow(freq + 0.01, profile.noiseTilt);
            noiseMagnitudes[noiseOffset + b] = profile.noiseLevel * tilt * amp;
        }
    }

    return { amplitudes, harmonicDistribution, noiseMagnitudes };
}

export { N_HARMONICS, N_NOISE_BANDS };
