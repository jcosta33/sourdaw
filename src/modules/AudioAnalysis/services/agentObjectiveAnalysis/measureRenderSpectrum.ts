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
 * Those frame spectra accumulate twice, and each figure reads the accumulation
 * its own definition asks for. The centroid reads the summed amplitudes, so it
 * is the balance point of the render's mean magnitude spectrum. The rolloff and
 * the band shares read the summed squares, because energy is what adds across
 * frames: squaring an amplitude that was already summed over frames raises a
 * band's share to the square of the number of frames it sounds in, which would
 * let a faint tone held for two hundred frames outweigh a full-scale one.
 *
 * Both accumulate rather than average per-frame figures. Averaging would weigh
 * every frame alike however little it carries, so a lead-in at -120 dBFS would
 * pull the centroid of a render that is otherwise a single loud tone.
 *
 * Each frame is measured with its own mean subtracted, per channel. Meyda
 * windows every frame, and a window spreads a constant offset over the lowest
 * bins instead of leaving it in bin 0, so dropping bin 0 alone would still let
 * a DC offset read as a sub-bass tone the render never sounds. Bin 0 stays out
 * of all three figures as well, because DC is a level the receipt reports on
 * its own and not a frequency.
 *
 * The last frame ends at the render's length rather than starting where the
 * stepped frames left off, so it overlaps the frame before it. That overlap
 * buys a whole window over real samples: a frame padded out to length instead
 * cuts the window at the pad boundary, and the step there leaks broadband
 * amplitude across every bin. The band shares and the rolloff square that leak
 * away, but the centroid weighs it linearly, so a padded frame moves the
 * centroid of a pure tone by hundreds of hertz in proportion to how far up the
 * window the padding begins.
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

/** The two weightings the readings need: amplitudes for the centroid, squares for energy. */
type SpectrumAccumulation = {
    readonly amplitude: Float64Array;
    readonly energy: Float64Array;
};

/**
 * Stepped frames over the render, then one final frame ending at its length.
 * Stepping alone reaches only a whole number of frames, leaving the samples
 * past the last one unmeasured, and no render is obliged to be a whole number
 * of frames long. The final frame overlaps the one before it by up to a frame
 * less one sample, which is the same treatment the windowed loudness meters
 * give their own trailing samples.
 */
function frameStartOffsets(length: number): readonly number[] {
    const starts: number[] = [];
    for (let offset = 0; offset + SPECTRUM_FRAME <= length; offset += SPECTRUM_FRAME) {
        starts.push(offset);
    }
    const finalStart = length - SPECTRUM_FRAME;
    if (finalStart > (starts[starts.length - 1] ?? 0)) {
        starts.push(finalStart);
    }
    return starts;
}

/**
 * The frame's own samples with their mean removed. Writing into a fresh frame
 * leaves the caller's channel as it was.
 */
function frameSamples(channel: Float32Array, offset: number): Float32Array {
    let total = 0;
    for (let index = 0; index < SPECTRUM_FRAME; index++) {
        total += channel[offset + index] ?? 0;
    }
    const mean = total / SPECTRUM_FRAME;

    const frame = new Float32Array(SPECTRUM_FRAME);
    for (let index = 0; index < SPECTRUM_FRAME; index++) {
        frame[index] = (channel[offset + index] ?? 0) - mean;
    }
    return frame;
}

/** The summed amplitude spectrum of one frame, or `null` when no channel yielded one. */
function sumChannelSpectra(channels: readonly Float32Array[], offset: number): Float64Array | null {
    let summed: Float64Array | null = null;
    for (const channel of channels) {
        const features = Meyda.extract(['amplitudeSpectrum'], frameSamples(channel, offset));
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

/** Adds one frame's spectrum to both accumulations, starting them when there are none. */
function accumulateFrame(accumulated: SpectrumAccumulation | null, frame: Float64Array): SpectrumAccumulation {
    const running = accumulated ?? {
        amplitude: new Float64Array(frame.length),
        energy: new Float64Array(frame.length),
    };
    for (let bin = 0; bin < frame.length; bin++) {
        const amplitude = frame[bin] ?? 0;
        running.amplitude[bin] = (running.amplitude[bin] ?? 0) + amplitude;
        running.energy[bin] = (running.energy[bin] ?? 0) + amplitude ** 2;
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
function rolloffHz(energy: Float64Array, sampleRate: number): number {
    let total = 0;
    for (let bin = FIRST_TONAL_BIN; bin < energy.length; bin++) {
        total += energy[bin] ?? 0;
    }
    const threshold = ROLLOFF_ENERGY_FRACTION * total;
    let cumulative = 0;
    for (let bin = FIRST_TONAL_BIN; bin < energy.length; bin++) {
        cumulative += energy[bin] ?? 0;
        if (cumulative >= threshold) {
            return binHz(bin, sampleRate);
        }
    }
    return binHz(energy.length - 1, sampleRate);
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
function bandEnergyProfile(energy: Float64Array, sampleRate: number): Record<FrequencyBand, number> | null {
    const totals = {} as Record<FrequencyBand, number>;
    for (const band of BANDS) {
        totals[band] = 0;
    }
    for (let bin = FIRST_TONAL_BIN; bin < energy.length; bin++) {
        const band = bandOfBin(bin, sampleRate);
        if (band) {
            totals[band] += energy[bin] ?? 0;
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
 * every frame it does have carries nothing but a constant — a spectrum measured
 * over zero frames is not a flat spectrum, it is no measurement. Since the
 * final frame ends at the render's length, no audio is left out by length: a
 * render at or above one frame reads null only when mean removal empties every
 * frame, which is a render with no sound in it. The caller distinguishes the
 * two cases by the render's own length.
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
    let accumulated: SpectrumAccumulation | null = null;

    try {
        Meyda.sampleRate = sampleRate;
        Meyda.bufferSize = SPECTRUM_FRAME;
        for (const offset of frameStartOffsets(length)) {
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
    const centroid = centroidHz(accumulated.amplitude, sampleRate);
    const bandEnergy = bandEnergyProfile(accumulated.energy, sampleRate);
    if (centroid === null || !bandEnergy) {
        return null;
    }

    return {
        centroidHz: centroid,
        rolloffHz: rolloffHz(accumulated.energy, sampleRate),
        bandEnergy,
    };
}
