import Meyda from 'meyda';

import { FREQUENCY_RANGES, type FrequencyBand } from '../../models/MixComparisonTypes';

/**
 * Mean spectral centroid, rolloff and per-band energy of a render.
 *
 * Every frame is measured from the elementwise sum of the per-channel amplitude
 * spectra. Channel 0 alone describes half a stereo render — a hard-panned tone
 * is simply absent from it — and a mono downmix cancels anti-phase content, so
 * either would report a spectrum the render does not have. Summing magnitudes
 * cancels nothing, because a magnitude carries no sign.
 *
 * Frames at digital silence are skipped rather than extracted. Meyda divides by
 * the spectrum's own amplitude sum for the centroid and walks its cumulative
 * amplitude down from the top bin for the rolloff, so an all-zero frame yields a
 * NaN centroid and a rolloff above Nyquist. Both are numbers, so a loop that
 * only checks the type carries them into the mean.
 */

/** 2048 samples: ~23 Hz resolution at 48 kHz, and the window `Meyda.extract` uses. */
export const SPECTRUM_FRAME = 2048;
/** Share of a frame's energy that lies below the rolloff frequency. */
const ROLLOFF_ENERGY_FRACTION = 0.85;

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

function binHz(bin: number, sampleRate: number): number {
    return (bin * sampleRate) / SPECTRUM_FRAME;
}

/** Amplitude-weighted mean bin of one frame, in hertz. */
function frameCentroidHz(spectrum: Float64Array, amplitudeSum: number, sampleRate: number): number {
    let weightedBins = 0;
    for (let bin = 0; bin < spectrum.length; bin++) {
        weightedBins += bin * (spectrum[bin] ?? 0);
    }
    return binHz(weightedBins / amplitudeSum, sampleRate);
}

/** Lowest frequency below which the frame carries its rolloff share of energy. */
function frameRolloffHz(spectrum: Float64Array, sampleRate: number): number {
    let energy = 0;
    for (const amplitude of spectrum) {
        energy += amplitude * amplitude;
    }
    const threshold = ROLLOFF_ENERGY_FRACTION * energy;
    let cumulative = 0;
    for (let bin = 0; bin < spectrum.length; bin++) {
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

/** Adds one frame's bin energy to the running per-band totals. */
function accumulateBandEnergy(totals: Record<FrequencyBand, number>, spectrum: Float64Array, sampleRate: number): void {
    for (let bin = 0; bin < spectrum.length; bin++) {
        const band = bandOfBin(bin, sampleRate);
        if (band) {
            totals[band] += (spectrum[bin] ?? 0) ** 2;
        }
    }
}

function emptyBandTotals(): Record<FrequencyBand, number> {
    const totals = {} as Record<FrequencyBand, number>;
    for (const band of BANDS) {
        totals[band] = 0;
    }
    return totals;
}

/** The band totals as shares of their sum, or `null` when they carry no energy. */
function normalizeBandEnergy(totals: Record<FrequencyBand, number>): Record<FrequencyBand, number> | null {
    const total = BANDS.reduce((sum, band) => sum + totals[band], 0);
    if (total <= 0) {
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
    const bandTotals = emptyBandTotals();
    let centroidSum = 0;
    let rolloffSum = 0;
    let frames = 0;

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
            centroidSum += frameCentroidHz(spectrum, amplitudeSum, sampleRate);
            rolloffSum += frameRolloffHz(spectrum, sampleRate);
            accumulateBandEnergy(bandTotals, spectrum, sampleRate);
            frames++;
        }
    } finally {
        Meyda.sampleRate = previousSampleRate;
        Meyda.bufferSize = previousBufferSize;
    }

    const bandEnergy = normalizeBandEnergy(bandTotals);
    if (frames === 0 || !bandEnergy) {
        return null;
    }

    return {
        centroidHz: centroidSum / frames,
        rolloffHz: rolloffSum / frames,
        bandEnergy,
    };
}
