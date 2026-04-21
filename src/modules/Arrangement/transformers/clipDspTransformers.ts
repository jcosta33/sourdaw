/**
 * Transformer: pure audio DSP helpers for clip editing.
 * No I/O — mathematical audio processing functions.
 */

export function findNearestZeroCrossing(data: Float32Array, targetSample: number, windowSize = 256): number {
    let bestOffset = 0;
    let bestDistance = Infinity;
    for (let offset = -windowSize; offset <= windowSize; offset++) {
        const idx = targetSample + offset;
        if (idx < 0 || idx >= data.length - 1) {
            continue;
        }
        if (data[idx]! * data[idx + 1]! <= 0) {
            if (Math.abs(offset) < bestDistance) {
                bestDistance = Math.abs(offset);
                bestOffset = offset;
            }
        }
    }
    return targetSample + bestOffset;
}

export type NormalizationMode = 'peak' | 'rms' | 'lufs';

/**
 * Computes the gain scale factor needed to normalize an AudioBuffer
 * to a target level using peak, RMS, or LUFS measurement.
 * Returns null if the buffer is silent.
 */
export function computeNormalizationScale(
    buffer: AudioBuffer,
    mode: NormalizationMode = 'peak',
    targetDb?: number
): number | null {
    if (mode === 'rms') {
        const target = targetDb ?? -14;
        let sumSq = 0;
        let totalSamples = 0;
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const data = buffer.getChannelData(ch);
            for (let index = 0; index < data.length; index++) {
                sumSq += data[index]! * data[index]!;
            }
            totalSamples += data.length;
        }
        const rms = Math.sqrt(sumSq / totalSamples);
        if (rms === 0) {
            return null;
        }
        const rmsDb = 20 * Math.log10(rms);
        const gainDb = target - rmsDb;
        return 10 ** (gainDb / 20);
    }

    if (mode === 'lufs') {
        const target = targetDb ?? -14;
        const sampleRate = buffer.sampleRate;
        const cutoff = 2000;
        const boostLinear = 10 ** (4 / 20);
        const rc = 1 / (2 * Math.PI * cutoff);
        const dt = 1 / sampleRate;
        const alpha = dt / (rc + dt);

        let sumSq = 0;
        let totalSamples = 0;
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const data = buffer.getChannelData(ch);
            let lpPrev = 0;
            for (let index = 0; index < data.length; index++) {
                const sample = data[index]!;
                lpPrev = lpPrev + alpha * (sample - lpPrev);
                const hp = sample - lpPrev;
                const weighted = lpPrev + hp * boostLinear;
                sumSq += weighted * weighted;
            }
            totalSamples += data.length;
        }
        const rms = Math.sqrt(sumSq / totalSamples);
        if (rms === 0) {
            return null;
        }
        const rmsDb = 20 * Math.log10(rms);
        const gainDb = target - rmsDb;
        return 10 ** (gainDb / 20);
    }

    // Peak normalization
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let index = 0; index < data.length; index++) {
            const abs = Math.abs(data[index]!);
            if (abs > peak) {
                peak = abs;
            }
        }
    }
    if (peak === 0) {
        return null;
    }
    return 1.0 / peak;
}
