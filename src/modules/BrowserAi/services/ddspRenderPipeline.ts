import { type DdspSettings } from '../models/InferenceRequest';

const SILENCE_DB = -120;
const CROSSFADE_SECONDS = 1;

type ConditionDdspInput = {
    pitchHz: Float32Array;
    loudnessDb: Float32Array;
    settings: DdspSettings;
};

export type DdspInferenceChunk = {
    f0Hz: Float32Array;
    loudnessDb: Float32Array;
};

function average(values: readonly number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Apply the pinned Magenta checkpoint's register and loudness statistics to MIDI-derived features. */
export function conditionDdspInput({ pitchHz, loudnessDb, settings }: ConditionDdspInput): DdspInferenceChunk {
    if (pitchHz.length !== loudnessDb.length) {
        throw new Error('DDSP pitch and loudness frame counts must match');
    }
    if (!pitchHz.every(Number.isFinite) || !loudnessDb.every(Number.isFinite)) {
        throw new TypeError('DDSP features must contain only finite values');
    }
    if (pitchHz.length === 0) {
        return { f0Hz: new Float32Array(), loudnessDb: new Float32Array() };
    }

    let maximumLoudness = Number.NEGATIVE_INFINITY;
    for (const loudness of loudnessDb) {
        maximumLoudness = Math.max(maximumLoudness, loudness);
    }
    const shifted = Array.from(loudnessDb, (loudness) => loudness + (settings.averageMaxLoudness - maximumLoudness));
    const aboveThreshold = shifted.filter((loudness) => loudness > settings.loudnessThreshold);
    const shiftedMean = average(aboveThreshold.length > 0 ? aboveThreshold : shifted);
    const clipped = shifted.map((loudness) =>
        Math.min(settings.averageMaxLoudness, Math.max(SILENCE_DB, loudness + settings.meanLoudness - shiftedMean))
    );
    let oldMinimum = Number.POSITIVE_INFINITY;
    for (const loudness of clipped) {
        oldMinimum = Math.min(oldMinimum, loudness);
    }
    const oldRange = shiftedMean - oldMinimum;
    const targetRange = settings.meanLoudness - SILENCE_DB;
    const conditionedLoudness = Float32Array.from(clipped, (loudness, index) => {
        if (pitchHz[index]! <= 0 || loudnessDb[index]! <= SILENCE_DB) {
            return SILENCE_DB;
        }
        if (!Number.isFinite(oldRange) || oldRange <= 0) {
            return Math.min(settings.averageMaxLoudness, Math.max(SILENCE_DB, loudness));
        }
        return Math.max(SILENCE_DB, ((loudness - oldMinimum) / oldRange) * targetRange + SILENCE_DB);
    });

    const voicedMidi = Array.from(pitchHz, (pitch, index) =>
        pitch > 0 && conditionedLoudness[index]! > settings.loudnessThreshold
            ? 69 + 12 * Math.log2(pitch / 440)
            : Number.NaN
    ).filter(Number.isFinite);
    const octaveShift = voicedMidi.length === 0 ? 0 : Math.round((settings.meanPitch - average(voicedMidi)) / 12);
    const octaveMultiplier = 2 ** octaveShift;
    const conditionedPitch = Float32Array.from(pitchHz, (pitch) => (pitch > 0 ? pitch * octaveMultiplier : 0));

    return { f0Hz: conditionedPitch, loudnessDb: conditionedLoudness };
}

export function createDdspInferenceChunks(input: {
    f0Hz: Float32Array;
    loudnessDb: Float32Array;
    frameRate: number;
    modelFrameLength: number;
}): DdspInferenceChunk[] {
    if (input.f0Hz.length !== input.loudnessDb.length) {
        throw new Error('DDSP pitch and loudness frame counts must match');
    }
    const overlapFrames = Math.min(Math.round(CROSSFADE_SECONDS * input.frameRate), input.modelFrameLength - 1);
    const hopFrames = input.modelFrameLength - Math.max(0, overlapFrames);
    if (input.f0Hz.length === 0 || hopFrames <= 0) {
        return [];
    }
    const chunks: DdspInferenceChunk[] = [];
    for (let start = 0; start < input.f0Hz.length; start += hopFrames) {
        const end = Math.min(start + input.modelFrameLength, input.f0Hz.length);
        const f0Hz = new Float32Array(input.modelFrameLength).fill(-1);
        const loudnessDb = new Float32Array(input.modelFrameLength).fill(SILENCE_DB);
        f0Hz.set(input.f0Hz.subarray(start, end));
        loudnessDb.set(input.loudnessDb.subarray(start, end));
        chunks.push({ f0Hz, loudnessDb });
        if (end === input.f0Hz.length) {
            break;
        }
    }
    return chunks;
}

export function joinDdspChunkAudio(chunks: readonly Float32Array[], overlapSamples: number): Float32Array {
    let joined = new Float32Array();
    for (const chunk of chunks) {
        if (joined.length === 0) {
            joined = new Float32Array(chunk);
            continue;
        }
        const overlap = Math.min(overlapSamples, joined.length, chunk.length);
        const next = new Float32Array(joined.length + chunk.length - overlap);
        next.set(joined);
        const overlapStart = joined.length - overlap;
        for (let index = 0; index < overlap; index += 1) {
            const ratio = index / overlap;
            next[overlapStart + index] = joined[overlapStart + index]! * (1 - ratio) + chunk[index]! * ratio;
        }
        next.set(chunk.subarray(overlap), joined.length);
        joined = next;
    }
    return joined;
}

/** Apply checkpoint gain without normalization, sanitize invalid samples, clip actual overs, and fit duration. */
export function finalizeDdspAudio(input: {
    audio: Float32Array;
    postGain: number;
    targetSamples: number;
}): Float32Array {
    const output = new Float32Array(input.targetSamples);
    const readable = Math.min(input.audio.length, input.targetSamples);
    for (let index = 0; index < readable; index += 1) {
        const amplified = input.audio[index]! * input.postGain;
        output[index] = Number.isFinite(amplified) ? Math.max(-1, Math.min(1, amplified)) : 0;
    }
    return output;
}
