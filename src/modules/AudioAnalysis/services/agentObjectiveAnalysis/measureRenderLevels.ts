/**
 * Level readings over a rendered buffer: the figures a mastering engineer reads
 * off a meter, each one a defined function of the samples alone.
 */

/** 100 ms — the frame a silence detector needs to be shorter than a musical rest. */
const SILENCE_FRAME_SECONDS = 0.1;
/** Below this, a 100 ms frame carries no programme material. */
const SILENCE_FRAME_DBFS = -70;
/** A render that still has this much level in its last 10 ms was cut off mid-sound. */
const TAIL_SECONDS = 0.01;
const TAIL_ENERGY_DBFS = -60;
/** At or below -100 dBFS a buffer carries no programme at all (the threshold `measureProgramAudio` uses). */
export const RENDER_SILENCE_LINEAR = 10 ** (-100 / 20);

export type RenderLevelReadings = {
    /** Highest absolute sample, linear. */
    readonly peak: number;
    readonly samplePeakDbfs: number;
    readonly rmsDbfs: number;
    /** Largest per-channel mean sample value, as a ratio of full scale. */
    readonly dcOffset: number;
    readonly clippingCount: number;
    readonly silentFraction: number;
    readonly tailEnergetic: boolean;
};

export type MeasureRenderLevelsInput = {
    readonly channels: readonly Float32Array[];
    readonly length: number;
    readonly sampleRate: number;
};

function toDbfs(linear: number): number {
    return 20 * Math.log10(linear);
}

/** Pooled RMS over every channel across `[start, end)`. */
function pooledRms(channels: readonly Float32Array[], start: number, end: number): number {
    const sampleCount = (end - start) * channels.length;
    if (sampleCount <= 0) {
        return 0;
    }
    let sumSquares = 0;
    for (const channel of channels) {
        for (let index = start; index < end; index++) {
            const sample = channel[index] ?? 0;
            sumSquares += sample * sample;
        }
    }
    return Math.sqrt(sumSquares / sampleCount);
}

/** Fraction of consecutive 100 ms frames whose pooled RMS sits below the silence floor. */
function measureSilentFraction(channels: readonly Float32Array[], length: number, sampleRate: number): number {
    const frameLength = Math.max(1, Math.round(SILENCE_FRAME_SECONDS * sampleRate));
    const frameCount = Math.ceil(length / frameLength);
    if (frameCount <= 0) {
        return 0;
    }
    const silenceFloor = 10 ** (SILENCE_FRAME_DBFS / 20);
    let silentFrames = 0;
    for (let frame = 0; frame < frameCount; frame++) {
        const start = frame * frameLength;
        const end = Math.min(length, start + frameLength);
        if (pooledRms(channels, start, end) < silenceFloor) {
            silentFrames++;
        }
    }
    return silentFrames / frameCount;
}

export function measureRenderLevels({ channels, length, sampleRate }: MeasureRenderLevelsInput): RenderLevelReadings {
    let peak = 0;
    let sumSquares = 0;
    let clippingCount = 0;
    let dcOffset = 0;

    for (const channel of channels) {
        let channelSum = 0;
        for (let index = 0; index < length; index++) {
            const sample = channel[index] ?? 0;
            const magnitude = Math.abs(sample);
            if (magnitude > peak) {
                peak = magnitude;
            }
            // Full scale counts as clipped: a sample pinned at 1.0 is already at
            // the converter's ceiling, whether or not it was rounded down to it.
            if (magnitude >= 1) {
                clippingCount++;
            }
            sumSquares += sample * sample;
            channelSum += sample;
        }
        const channelMean = length > 0 ? Math.abs(channelSum / length) : 0;
        if (channelMean > dcOffset) {
            dcOffset = channelMean;
        }
    }

    const sampleCount = length * channels.length;
    const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
    const tailStart = Math.max(0, length - Math.round(TAIL_SECONDS * sampleRate));

    return {
        peak,
        samplePeakDbfs: toDbfs(peak),
        rmsDbfs: toDbfs(rms),
        dcOffset,
        clippingCount,
        silentFraction: measureSilentFraction(channels, length, sampleRate),
        tailEnergetic: toDbfs(pooledRms(channels, tailStart, length)) > TAIL_ENERGY_DBFS,
    };
}
