import Meyda from 'meyda';

import { FREQUENCY_RANGES, type FrequencyBand } from '../../models/MixComparisonTypes';

/**
 * Spectral centroid, rolloff and per-band energy of a render.
 *
 * Every frame is measured from the elementwise sum of the per-channel amplitude
 * spectra. Channel 0 alone describes half a stereo render — a hard-panned tone
 * is simply absent from it — and a mono downmix cancels anti-phase content, so
 * either would report a spectrum the render does not have. Summing magnitudes
 * cancels nothing, because a magnitude carries no sign.
 *
 * Those frame spectra accumulate into one spectrum, and all three figures are
 * derived from that sum. Deriving them per frame and averaging would weigh
 * every frame alike however little it carries, so a lead-in at -120 dBFS would
 * pull the centroid of a render that is otherwise a single loud tone.
 *
 * Bin 0 is left out of all three. It holds the render's DC offset, which is a
 * level the receipt reports on its own and not a frequency the render sounds:
 * counted as a bin it drags the centroid towards 0 Hz in proportion to the
 * offset.
 *
 * Frames at digital silence are skipped rather than accumulated. Meyda returns
 * an all-zero spectrum for them, which contributes nothing, but skipping keeps
 * a render whose every frame is empty distinguishable from one that was
 * measured.
 */

/** 2048 samples: ~23 Hz resolution at 48 kHz, and the window `Meyda.extract` uses. */
export const SPECTRUM_FRAME = 2048;
/** Share of a render's energy that lies below the rolloff frequency. */
const ROLLOFF_ENERGY_FRACTION = 0.85;
/** Bin 0 carries DC, not a frequency: every figure here starts above it. */
const FIRST_TONAL_BIN = 1;

const BANDS = Object.keys(FREQUENCY_RANGES) as FrequencyBand[];

export type RenderSpectrumReadings = {
    readonly centroidHz: number;
    readonly rolloffHz: number;
    /** Relative energy per advertised band, summing to 1. */
    readonly bandEnergy: Readonly<Record<FrequencyBand, number>>;
};

export type MeasureRenderSpectrumInput = {
    readonly channels: readonly Float32Array[];
    readonly length: number;
    readonly sampleRate: number;
};

/** The summed amplitude spectrum of one frame, or `null` when no channel yielded one. */
function sumChannelSpectra(channels: readonly Float32Array[], offset: number): Float64Array | null {
    let summed: Float64Array | null = null;
    for (const channel of channels) {
        const features = Meyda.extract(['amplitudeSpectrum'], channel.subarray(offset, offset + SPECTRUM_FRAME));
        const spectrum = features?.amplitudeSpectrum;
        if (!spectrum) {
            continue;
        }
        summed ??= new Float64Array(spectrum.length);
        for (let bin = 0; bin < summed.length; bin++) {
            summed[bin] = (summed[bin] ?? 0) + (spectrum[bin] ?? 0);
        }
    }
    return summed;
}

function amplitudeTotal(spectrum: Float64Array): number {
    let total = 0;
    for (const amplitude of spectrum) {
        total += amplitude;
    }
    return total;
}

/** Adds one frame's spectrum to the running accumulation, starting it when there is none. */
function accumulateFrame(accumulated: Float64Array | null, frame: Float64Array): Float64Array {
    const running = accumulated ?? new Float64Array(frame.length);
    for (let bin = 0; bin < running.length; bin++) {
        running[bin] = (running[bin] ?? 0) + (frame[bin] ?? 0);
    }
    return running;
}

function binHz(bin: number, sampleRate: number): number {
    return (bin * sampleRate) / SPECTRUM_FRAME;
}

/** Amplitude-weighted mean bin, in hertz, or `null` when no bin above DC carries amplitude. */
function centroidHz(spectrum: Float64Array, sampleRate: number): number | null {
    let weightedBins = 0;
    let amplitude = 0;
    for (let bin = FIRST_TONAL_BIN; bin < spectrum.length; bin++) {
        const binAmplitude = spectrum[bin] ?? 0;
        weightedBins += bin * binAmplitude;
        amplitude += binAmplitude;
    }
    if (!Number.isFinite(amplitude) || amplitude <= 0) {
        return null;
    }
    return binHz(weightedBins / amplitude, sampleRate);
}

/** Lowest frequency below which the render carries its rolloff share of energy. */
function rolloffHz(spectrum: Float64Array, sampleRate: number): number {
    let energy = 0;
    for (let bin = FIRST_TONAL_BIN; bin < spectrum.length; bin++) {
        energy += (spectrum[bin] ?? 0) ** 2;
    }
    const threshold = ROLLOFF_ENERGY_FRACTION * energy;
    let cumulative = 0;
    for (let bin = FIRST_TONAL_BIN; bin < spectrum.length; bin++) {
        cumulative += (spectrum[bin] ?? 0) ** 2;
        if (cumulative >= threshold) {
            return binHz(bin, sampleRate);
        }
    }
    return binHz(spectrum.length - 1, sampleRate);
}

function bandOfBin(bin: number, sampleRate: number): FrequencyBand | null {
    const centerHz = binHz(bin, sampleRate);
    for (const band of BANDS) {
        const [low, high] = FREQUENCY_RANGES[band];
        if (centerHz >= low && centerHz < high) {
            return band;
        }
    }
    return null;
}

/** The accumulated bin energy as shares per band, or `null` when the bands carry none. */
function bandEnergyProfile(spectrum: Float64Array, sampleRate: number): Record<FrequencyBand, number> | null {
    const totals = {} as Record<FrequencyBand, number>;
    for (const band of BANDS) {
        totals[band] = 0;
    }
    for (let bin = FIRST_TONAL_BIN; bin < spectrum.length; bin++) {
        const band = bandOfBin(bin, sampleRate);
        if (band) {
            totals[band] += (spectrum[bin] ?? 0) ** 2;
        }
    }

    const total = BANDS.reduce((sum, band) => sum + totals[band], 0);
    if (!Number.isFinite(total) || total <= 0) {
        return null;
    }
    const profile = {} as Record<FrequencyBand, number>;
    for (const band of BANDS) {
        profile[band] = totals[band] / total;
    }
    return profile;
}

/**
 * Returns `null` when the render is shorter than one analysis frame, or when
 * every whole frame it does have sits at digital silence — a spectrum measured
 * over zero frames is not a flat spectrum, it is no measurement. The caller
 * distinguishes the two cases by the render's own length.
 */
export function measureRenderSpectrum({
    channels,
    length,
    sampleRate,
}: MeasureRenderSpectrumInput): RenderSpectrumReadings | null {
    if (length < SPECTRUM_FRAME || channels.length === 0) {
        return null;
    }

    // Meyda reads its sample rate and window size off the module singleton;
    // both are restored below to the values this call found them at.
    const previousSampleRate = Meyda.sampleRate;
    const previousBufferSize = Meyda.bufferSize;
    let accumulated: Float64Array | null = null;

    try {
        Meyda.sampleRate = sampleRate;
        Meyda.bufferSize = SPECTRUM_FRAME;
        for (let offset = 0; offset + SPECTRUM_FRAME <= length; offset += SPECTRUM_FRAME) {
            const spectrum = sumChannelSpectra(channels, offset);
            if (!spectrum) {
                continue;
            }
            const amplitudeSum = amplitudeTotal(spectrum);
            if (!Number.isFinite(amplitudeSum) || amplitudeSum <= 0) {
                continue;
            }
            accumulated = accumulateFrame(accumulated, spectrum);
        }
    } finally {
        Meyda.sampleRate = previousSampleRate;
        Meyda.bufferSize = previousBufferSize;
    }

    if (!accumulated) {
        return null;
    }
    const centroid = centroidHz(accumulated, sampleRate);
    const bandEnergy = bandEnergyProfile(accumulated, sampleRate);
    if (centroid === null || !bandEnergy) {
        return null;
    }

    return {
        centroidHz: centroid,
        rolloffHz: rolloffHz(accumulated, sampleRate),
        bandEnergy,
    };
}
