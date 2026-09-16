import Meyda from 'meyda';

import { type MixAnalysis, FREQUENCY_RANGES, type FrequencyBand } from '../../../models/MixComparisonTypes';

/**
 * Measure a `MixAnalysis` from explicit program PCM.
 *
 * Every number this module produces is read out of the samples it is given:
 * nothing is derived from track layout, gain, or pan metadata. The caller owns
 * obtaining the program audio (a retained mix render); when it has none, the
 * analyzer reports unavailable instead of estimating.
 *
 * Documented measurement contracts:
 * - `rmsDb`/`peakDb` are dBFS over every sample of every supplied channel.
 * - `lufs` is an unweighted estimate (identical to `rmsDb`); BS.1770 K-weighting
 *   and gating are not applied, so it responds to real audio but is not a
 *   certified loudness measurement.
 * - `dynamicRange` is the 95th-percentile frame peak minus the 10th-percentile
 *   frame RMS (2048-sample frames, 512-sample hop, channel-average mono), the
 *   same window the module's feature extractor uses.
 * - `stereoWidth` maps interchannel correlation to 0–1: identical channels → 0
 *   (mono), decorrelated channels → ~0.5. Mono files contribute no correlation.
 * - `frequencyProfile` is relative energy (0–1) per advertised band, computed
 *   from an 8192-point amplitude spectrum (5.4–5.9 Hz bin spacing at 44.1/48 kHz
 *   — enough to own the 20–60 Hz band) with each bin attributed by center
 *   frequency to exactly one band. Buffers shorter than the spectrum window
 *   contribute levels but no profile.
 */

const FRAME_WINDOW = 2048;
const FRAME_HOP = 512;
const SPECTRUM_WINDOW = 8192;
/** At or below −100 dBFS a buffer carries no program material. */
const SILENCE_LINEAR = 10 ** (-100 / 20);

function percentile(values: readonly number[], fraction: number): number {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
    return sorted[index]!;
}

function monoChannelAverage(buffer: AudioBuffer): Float32Array {
    const left = buffer.getChannelData(0);
    if (buffer.numberOfChannels < 2) {
        return left;
    }
    const right = buffer.getChannelData(1);
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
        mono[i] = (left[i]! + right[i]!) / 2;
    }
    return mono;
}

function measureFrequencyProfile(buffers: readonly AudioBuffer[]): Record<FrequencyBand, number> {
    const profile = {} as Record<FrequencyBand, number>;
    for (const band of Object.keys(FREQUENCY_RANGES) as FrequencyBand[]) {
        profile[band] = 0;
    }

    /** Adds one rendered window's spectral energy into the per-band profile,
     * attributing each bin to the band whose range contains its center. */
    function accumulateBandEnergy(
        profile: Record<FrequencyBand, number>,
        sampleRate: number,
        spectrum: ArrayLike<number>
    ): void {
        const binWidthHz = sampleRate / SPECTRUM_WINDOW;
        for (let bin = 1; bin < spectrum.length; bin++) {
            const centerHz = bin * binWidthHz;
            for (const band of Object.keys(FREQUENCY_RANGES) as FrequencyBand[]) {
                const [low, high] = FREQUENCY_RANGES[band];
                if (centerHz >= low && centerHz < high) {
                    profile[band] += (spectrum[bin] ?? 0) ** 2;
                    break;
                }
            }
        }
    }

    const prevSampleRate = Meyda.sampleRate;
    const prevBufferSize = Meyda.bufferSize;
    try {
        for (const buffer of buffers) {
            if (buffer.length < SPECTRUM_WINDOW) {
                continue;
            }
            Meyda.sampleRate = buffer.sampleRate;
            Meyda.bufferSize = SPECTRUM_WINDOW;
            const mono = monoChannelAverage(buffer);
            const features = Meyda.extract(['amplitudeSpectrum'], mono.subarray(0, SPECTRUM_WINDOW));
            const spectrum = features?.amplitudeSpectrum;
            if (!spectrum) {
                continue;
            }
            accumulateBandEnergy(profile, buffer.sampleRate, spectrum);
        }
    } finally {
        Meyda.sampleRate = prevSampleRate;
        Meyda.bufferSize = prevBufferSize;
    }

    const total = Object.values(profile).reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
        // No buffer was long enough to spectrum-analyze: the profile is
        // explicitly flat rather than invented per-band structure.
        const bandCount = (Object.keys(FREQUENCY_RANGES) as FrequencyBand[]).length;
        for (const band of Object.keys(profile) as FrequencyBand[]) {
            profile[band] = 1 / bandCount;
        }
        return profile;
    }
    for (const band of Object.keys(profile) as FrequencyBand[]) {
        profile[band] = profile[band] / total;
    }
    return profile;
}

/**
 * Measure the supplied program audio, or return `null` when it is silent —
 * silence is a real measured state the caller must surface, not numbers.
 */
export function measureProgramAudio(programAudio: readonly AudioBuffer[]): MixAnalysis | null {
    let peak = 0;
    let sumSquares = 0;
    let sampleCount = 0;
    const framePeakDb: number[] = [];
    const frameRmsDb: number[] = [];
    let sumLeftSquares = 0;
    let sumRightSquares = 0;
    let sumLeftRight = 0;

    for (const buffer of programAudio) {
        const channels = Math.min(2, buffer.numberOfChannels);
        for (let channel = 0; channel < channels; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < data.length; i++) {
                const sample = data[i]!;
                const abs = Math.abs(sample);
                if (abs > peak) {
                    peak = abs;
                }
                sumSquares += sample * sample;
            }
            sampleCount += data.length;
        }
        if (channels === 2) {
            const left = buffer.getChannelData(0);
            const right = buffer.getChannelData(1);
            for (let i = 0; i < left.length; i++) {
                const leftSample = left[i]!;
                const rightSample = right[i]!;
                sumLeftSquares += leftSample * leftSample;
                sumRightSquares += rightSample * rightSample;
                sumLeftRight += leftSample * rightSample;
            }
        }

        const mono = monoChannelAverage(buffer);
        for (let offset = 0; offset + FRAME_WINDOW <= mono.length; offset += FRAME_HOP) {
            let framePeak = 0;
            let frameSumSquares = 0;
            for (let i = offset; i < offset + FRAME_WINDOW; i++) {
                const sample = Math.abs(mono[i]!);
                if (sample > framePeak) {
                    framePeak = sample;
                }
                frameSumSquares += sample * sample;
            }
            framePeakDb.push(20 * Math.log10(Math.max(framePeak, SILENCE_LINEAR)));
            frameRmsDb.push(20 * Math.log10(Math.max(Math.sqrt(frameSumSquares / FRAME_WINDOW), SILENCE_LINEAR)));
        }
    }

    if (sampleCount === 0 || peak <= SILENCE_LINEAR) {
        return null;
    }

    const rms = Math.sqrt(sumSquares / sampleCount);
    const peakDb = 20 * Math.log10(peak);
    const rmsDb = 20 * Math.log10(rms);

    let stereoWidth = 0;
    if (sumLeftSquares > 0 && sumRightSquares > 0) {
        const correlation = sumLeftRight / Math.sqrt(sumLeftSquares * sumRightSquares);
        stereoWidth = Math.min(1, Math.max(0, (1 - correlation) / 2));
    }

    const dynamicRange = Math.min(40, Math.max(0, percentile(framePeakDb, 0.95) - percentile(frameRmsDb, 0.1)));

    return {
        rmsDb,
        peakDb,
        lufs: rmsDb,
        frequencyProfile: measureFrequencyProfile(programAudio),
        stereoWidth,
        dynamicRange,
        crestFactor: peakDb - rmsDb,
    };
}
