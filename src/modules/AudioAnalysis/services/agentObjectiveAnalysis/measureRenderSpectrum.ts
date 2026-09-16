import Meyda from 'meyda';

/**
 * Mean spectral centroid and rolloff of a render, in hertz.
 *
 * Meyda reports the two in different units, which is the whole reason this
 * conversion lives in one named place: `spectralCentroid` is the amplitude-
 * weighted mean *bin index* (`mu(1, ampSpectrum)`), while `spectralRolloff`
 * already returns hertz (`(n + 1) * sampleRate / (2 * (ampSpectrum.length - 1))`
 * in meyda's `featureExtractors`). Converting the rolloff as if it were a bin
 * reads a 1 kHz tone as roughly 25 kHz — above Nyquist, and silently wrong in a
 * receipt an agent would cite.
 */

/** 2048 samples: ~23 Hz resolution at 48 kHz, and the window `extractFeatures` uses. */
const SPECTRUM_FRAME = 2048;

export type RenderSpectrumReadings = {
    readonly centroidHz: number;
    readonly rolloffHz: number;
};

export type MeasureRenderSpectrumInput = {
    readonly channel: Float32Array;
    readonly length: number;
    readonly sampleRate: number;
};

/**
 * Returns `null` when the render is shorter than one analysis frame — a
 * spectrum measured over zero frames is not a flat spectrum, it is no
 * measurement.
 */
export function measureRenderSpectrum({
    channel,
    length,
    sampleRate,
}: MeasureRenderSpectrumInput): RenderSpectrumReadings | null {
    if (length < SPECTRUM_FRAME) {
        return null;
    }

    // Meyda reads its sample rate and window size off the module singleton;
    // restore the caller's values so one analysis never reconfigures the next.
    const previousSampleRate = Meyda.sampleRate;
    const previousBufferSize = Meyda.bufferSize;
    let centroidBinSum = 0;
    let rolloffHzSum = 0;
    let frames = 0;

    try {
        Meyda.sampleRate = sampleRate;
        Meyda.bufferSize = SPECTRUM_FRAME;
        for (let offset = 0; offset + SPECTRUM_FRAME <= length; offset += SPECTRUM_FRAME) {
            const features = Meyda.extract(
                ['spectralCentroid', 'spectralRolloff'],
                channel.subarray(offset, offset + SPECTRUM_FRAME)
            );
            const centroidBin = features?.spectralCentroid;
            const rolloffHz = features?.spectralRolloff;
            if (typeof centroidBin !== 'number' || typeof rolloffHz !== 'number') {
                continue;
            }
            centroidBinSum += centroidBin;
            rolloffHzSum += rolloffHz;
            frames++;
        }
    } finally {
        Meyda.sampleRate = previousSampleRate;
        Meyda.bufferSize = previousBufferSize;
    }

    if (frames === 0) {
        return null;
    }

    return {
        centroidHz: ((centroidBinSum / frames) * sampleRate) / SPECTRUM_FRAME,
        rolloffHz: rolloffHzSum / frames,
    };
}
