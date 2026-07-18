/**
 * Pure spectral-flux onset detector.
 *
 * Sensitivity 0..1 maps to a standard-deviation multiplier so the same value
 * produces a comparable hit count across material — high sensitivity (1) keeps
 * soft onsets, low sensitivity (0) only fires on strong transients.
 */

const FFT_SIZE = 2048;
const HOP_SIZE = 512;

export type TransientHit = {
    sampleOffset: number;
    confidence: number;
};

export function detectTransients(
    samples: Float32Array,
    sampleRate: number,
    sensitivity: number
): readonly TransientHit[] {
    if (samples.length < FFT_SIZE) {
        return [];
    }
    const clampedSensitivity = Math.max(0, Math.min(1, sensitivity));
    const stdMultiplier = 3 - clampedSensitivity * 2.5;

    const flux = computeSpectralFlux(samples);
    return pickPeaks(flux, sampleRate, stdMultiplier);
}

function computeSpectralFlux(samples: Float32Array): Float32Array {
    const frameCount = Math.floor((samples.length - FFT_SIZE) / HOP_SIZE) + 1;
    if (frameCount <= 1) {
        return new Float32Array(0);
    }
    const window = hannWindow(FFT_SIZE);
    const re = new Float32Array(FFT_SIZE);
    const im = new Float32Array(FFT_SIZE);
    const previousMag = new Float32Array(FFT_SIZE / 2);
    const flux = new Float32Array(frameCount);

    for (let f = 0; f < frameCount; f++) {
        const start = f * HOP_SIZE;
        for (let i = 0; i < FFT_SIZE; i++) {
            re[i] = samples[start + i]! * window[i]!;
            im[i] = 0;
        }
        fftInPlace(re, im);
        let frameFlux = 0;
        for (let k = 0; k < FFT_SIZE / 2; k++) {
            const mag = Math.hypot(re[k]!, im[k]!);
            const diff = mag - previousMag[k]!;
            if (diff > 0) {
                frameFlux += diff;
            }
            previousMag[k] = mag;
        }
        flux[f] = frameFlux;
    }
    return flux;
}

/**
 * Sensitivity controls a global-max-relative threshold and a refractory window.
 *
 * Why not "mean + k*std" of the local window: a single percussive transient
 * smears across ~4 FFT frames at HOP_SIZE 512, so the local window around a
 * peak already contains the peak's energy spread out — `std` becomes large and
 * the test rejects the very thing it's trying to detect on sparse material
 * (drum hits in silence). A global-max-relative cutoff is robust here, and the
 * refractory window prevents the smeared peak from registering twice.
 */
function pickPeaks(flux: Float32Array, sampleRate: number, stdMultiplier: number): TransientHit[] {
    if (flux.length < 3) {
        return [];
    }
    let maxFlux = 0;
    for (let i = 0; i < flux.length; i++) {
        if (flux[i]! > maxFlux) {
            maxFlux = flux[i]!;
        }
    }
    if (maxFlux === 0) {
        return [];
    }
    const clamped = Math.max(0.5, Math.min(3, stdMultiplier));
    const relativeCutoff = 0.04 + (clamped - 0.5) * 0.184;
    const cutoff = relativeCutoff * maxFlux;

    const refractoryFrames = Math.max(2, Math.floor(0.04 * (sampleRate / HOP_SIZE)));

    const hits: TransientHit[] = [];
    let lastHitFrame = -refractoryFrames;
    for (let i = 1; i < flux.length - 1; i++) {
        const here = flux[i]!;
        if (here < cutoff) {
            continue;
        }
        if (here <= flux[i - 1]! || here <= flux[i + 1]!) {
            continue;
        }
        if (i - lastHitFrame < refractoryFrames) {
            continue;
        }
        const sampleOffset = i * HOP_SIZE;
        const confidence = Math.min(1, here / maxFlux);
        hits.push({ sampleOffset, confidence });
        lastHitFrame = i;
    }
    return hits;
}

function hannWindow(size: number): Float32Array {
    const w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    }
    return w;
}

// Iterative radix-2 Cooley-Tukey FFT, in-place. Length must be a power of two.
function fftInPlace(re: Float32Array, im: Float32Array): void {
    const n = re.length;
    let j = 0;
    for (let i = 1; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) {
            j ^= bit;
        }
        j ^= bit;
        if (i < j) {
            const tr = re[i]!;
            const ti = im[i]!;
            re[i] = re[j]!;
            im[i] = im[j]!;
            re[j] = tr;
            im[j] = ti;
        }
    }
    for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const angleStep = (-2 * Math.PI) / size;
        for (let start = 0; start < n; start += size) {
            for (let k = 0; k < half; k++) {
                const angle = angleStep * k;
                const wr = Math.cos(angle);
                const wi = Math.sin(angle);
                const a = start + k;
                const b = a + half;
                const tre = re[b]! * wr - im[b]! * wi;
                const tim = re[b]! * wi + im[b]! * wr;
                re[b] = re[a]! - tre;
                im[b] = im[a]! - tim;
                re[a] = re[a]! + tre;
                im[a] = im[a]! + tim;
            }
        }
    }
}
