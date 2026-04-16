/**
 * Service: DDSP additive + subtractive synthesizer in pure TypeScript.
 *
 * Implements the two core DDSP synthesis components:
 * 1. Harmonic synthesizer — sum of sinusoids at integer multiples of f0
 * 2. Filtered noise synthesizer — white noise shaped by a learned magnitude spectrum
 *
 * The ML part (predicting synthesis parameters from pitch/loudness) runs in ONNX.
 * This module handles only the deterministic DSP — no ML framework dependency.
 *
 * Ported from magenta/ddsp-vst C++ (HarmonicSynthesizer.cpp, NoiseSynthesizer.cpp).
 * Reference: DDSP ICLR 2020 — https://arxiv.org/abs/2001.04643
 */

const TWO_PI = 2 * Math.PI;

type DdspSynthesisParams = {
    /** Per-frame fundamental frequency in Hz, shape [nFrames] */
    f0Hz: Float32Array;
    /** Per-frame overall amplitude (linear), shape [nFrames] */
    amplitudes: Float32Array;
    /** Per-frame harmonic distribution, shape [nFrames * nHarmonics] (row-major) */
    harmonicDistribution: Float32Array;
    /** Per-frame noise magnitude spectrum, shape [nFrames * nNoiseBands] (row-major) */
    noiseMagnitudes: Float32Array;
    /** Number of harmonics (typically 100) */
    nHarmonics: number;
    /** Number of noise filter bands (typically 65) */
    nNoiseBands: number;
    /** Number of parameter frames */
    nFrames: number;
    /** Audio sample rate (output) */
    sampleRate: number;
    /** Samples per parameter frame (frame_size = sampleRate / frameRate) */
    samplesPerFrame: number;
};

/**
 * Synthesize audio from DDSP parameters.
 * Returns a Float32Array of audio samples at the specified sample rate.
 */
export function ddspSynthesize(params: DdspSynthesisParams): Float32Array {
    const totalSamples = params.nFrames * params.samplesPerFrame;
    const harmonic = synthesizeHarmonics(params, totalSamples);
    const noise = synthesizeNoise(params, totalSamples);

    // Sum harmonic + noise signals
    const output = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
        output[i] = harmonic[i]! + noise[i]!;
    }
    return output;
}

/**
 * Harmonic synthesizer: additive synthesis with phase accumulation.
 *
 * For each audio sample, accumulates the phase of the fundamental frequency
 * and sums sine waves at harmonic frequencies (k × f0) weighted by the
 * learned harmonic distribution.
 *
 * Parameters are linearly interpolated between frames to avoid discontinuities.
 */
function synthesizeHarmonics(params: DdspSynthesisParams, totalSamples: number): Float32Array {
    const { f0Hz, amplitudes, harmonicDistribution, nHarmonics, nFrames, sampleRate, samplesPerFrame } = params;
    const output = new Float32Array(totalSamples);

    let phase = 0;

    for (let i = 0; i < totalSamples; i++) {
        // Determine which frame we're in and the interpolation factor
        const framePos = i / samplesPerFrame;
        const frame0 = Math.min(Math.floor(framePos), nFrames - 1);
        const frame1 = Math.min(frame0 + 1, nFrames - 1);
        const t = framePos - frame0; // interpolation factor [0, 1)

        // Interpolate f0 and amplitude
        const f0 = f0Hz[frame0]! * (1 - t) + f0Hz[frame1]! * t;
        const amp = amplitudes[frame0]! * (1 - t) + amplitudes[frame1]! * t;

        // Advance phase (phase accumulation — the core of DDSP)
        phase += TWO_PI * f0 / sampleRate;
        if (phase > TWO_PI) {
            phase -= TWO_PI;
        }

        // Skip synthesis if f0 is zero (silence) or amplitude is negligible
        if (f0 < 20 || amp < 1e-6) {
            continue;
        }

        // Sum harmonics
        let sample = 0;
        const offset0 = frame0 * nHarmonics;
        const offset1 = frame1 * nHarmonics;
        for (let k = 0; k < nHarmonics; k++) {
            // Interpolate harmonic amplitude
            const hAmp = harmonicDistribution[offset0 + k]! * (1 - t) + harmonicDistribution[offset1 + k]! * t;
            if (hAmp < 1e-7) {
                continue;
            }
            // k+1 because harmonic 0 is the fundamental (1× f0)
            sample += hAmp * Math.sin(phase * (k + 1));
        }

        output[i] = amp * sample;
    }

    return output;
}

/**
 * Filtered noise synthesizer: frequency-domain noise shaping.
 *
 * For each frame:
 * 1. Generate a frame of white noise
 * 2. Apply the learned magnitude spectrum via frequency-domain multiplication
 * 3. Overlap-add adjacent frames with a Hann window for smooth transitions
 *
 * Uses a simple real-valued FFT approximation via DFT for the filter application.
 */
function synthesizeNoise(params: DdspSynthesisParams, totalSamples: number): Float32Array {
    const { noiseMagnitudes, nNoiseBands, nFrames, samplesPerFrame } = params;
    const output = new Float32Array(totalSamples);

    // FFT size for the noise filter — next power of 2 >= samplesPerFrame * 2
    const fftSize = nextPow2(samplesPerFrame * 2);
    const halfFft = fftSize / 2 + 1;

    // Precompute Hann window for overlap-add
    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
        window[i] = 0.5 * (1 - Math.cos(TWO_PI * i / fftSize));
    }

    for (let frame = 0; frame < nFrames; frame++) {
        const magOffset = frame * nNoiseBands;

        // Generate white noise frame
        const noiseFrame = new Float32Array(fftSize);
        for (let i = 0; i < fftSize; i++) {
            noiseFrame[i] = (Math.random() * 2 - 1) * window[i]!;
        }

        // Interpolate noise magnitudes to FFT bin count
        const magnitudes = interpolateMagnitudes(
            noiseMagnitudes, magOffset, nNoiseBands, halfFft
        );

        // Apply filter in frequency domain via real DFT
        const filtered = applySpectralFilter(noiseFrame, magnitudes, fftSize);

        // Overlap-add into output
        const startSample = frame * samplesPerFrame;
        const end = Math.min(fftSize, totalSamples - startSample);
        for (let i = 0; i < end; i++) {
            output[startSample + i] = (output[startSample + i] ?? 0) + filtered[i]!;
        }
    }

    return output;
}

/**
 * Interpolate nNoiseBands magnitude values to halfFft frequency bins
 * using linear interpolation.
 */
function interpolateMagnitudes(
    mags: Float32Array, offset: number, nBands: number, nBins: number
): Float32Array {
    const result = new Float32Array(nBins);
    for (let bin = 0; bin < nBins; bin++) {
        const pos = (bin / (nBins - 1)) * (nBands - 1);
        const idx0 = Math.floor(pos);
        const idx1 = Math.min(idx0 + 1, nBands - 1);
        const frac = pos - idx0;
        result[bin] = mags[offset + idx0]! * (1 - frac) + mags[offset + idx1]! * frac;
    }
    return result;
}

/**
 * Apply a spectral magnitude filter to a time-domain signal.
 * Uses a naive DFT (not FFT) — acceptable for the small frame sizes used here
 * (typically 128-256 samples). For production, replace with a proper FFT library.
 */
function applySpectralFilter(signal: Float32Array, magnitudes: Float32Array, fftSize: number): Float32Array {
    const halfN = fftSize / 2 + 1;
    // Forward DFT → real and imaginary parts
    const re = new Float32Array(halfN);
    const im = new Float32Array(halfN);

    for (let k = 0; k < halfN; k++) {
        let sumRe = 0;
        let sumIm = 0;
        for (let n = 0; n < fftSize; n++) {
            const angle = TWO_PI * k * n / fftSize;
            sumRe += signal[n]! * Math.cos(angle);
            sumIm -= signal[n]! * Math.sin(angle);
        }
        re[k] = sumRe;
        im[k] = sumIm;
    }

    // Multiply by magnitude spectrum
    for (let k = 0; k < halfN; k++) {
        re[k]! *= magnitudes[k]!;
        im[k]! *= magnitudes[k]!;
    }

    // Inverse DFT
    const output = new Float32Array(fftSize);
    for (let n = 0; n < fftSize; n++) {
        let sum = 0;
        for (let k = 0; k < halfN; k++) {
            const angle = TWO_PI * k * n / fftSize;
            sum += re[k]! * Math.cos(angle) + im[k]! * Math.sin(angle);
            // Mirror (conjugate symmetry for real signal)
            if (k > 0 && k < halfN - 1) {
                sum += re[k]! * Math.cos(angle) - im[k]! * Math.sin(angle);
            }
        }
        output[n] = sum / fftSize;
    }

    return output;
}

function nextPow2(n: number): number {
    let p = 1;
    while (p < n) {
        p *= 2;
    }
    return p;
}
