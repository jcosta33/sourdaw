import { measureIntegratedLoudness } from '../../src/modules/AudioRendering/repositories/audioEncoders/measureIntegratedLoudness';
import { measureTruePeak } from '../../src/modules/AudioRendering/repositories/audioEncoders/measureTruePeak';

const PCM24_NEGATIVE_SCALE = 0x80_0000;
const PCM24_RANGE = 0x100_0000;
const LOW_FREQUENCY_CUTOFF_HZ = 150;
const ACTIVE_BLOCK_SECONDS = 1;
const ACTIVE_BLOCK_RMS = 0.001;

type WavPayload = {
    audioFormat: number;
    bitsPerSample: number;
    channels: number;
    dataBytes: number;
    dataOffset: number;
    sampleRate: number;
};

type DecodedPcm = {
    channelData: Float32Array[];
    clippedSampleCount: number;
    dcOffsets: number[];
    length: number;
    samplePeak: number;
};

export type PcmWavAnalysis = {
    activeBlockRatio: number;
    audioFormat: number;
    bitsPerSample: number;
    channels: number;
    clippedSampleCount: number;
    dataBytes: number;
    dcOffsets: number[];
    durationSeconds: number;
    integratedLufs: number;
    lowCorrelation: number;
    lowMonoCompatibilityDb: number;
    samplePeak: number;
    sampleRate: number;
    truePeakDbTp: number;
};

function readAscii(bytes: Uint8Array, start: number, end: number): string {
    let value = '';
    for (let index = start; index < end; index++) {
        value += String.fromCharCode(bytes[index]);
    }
    return value;
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function findWavPayload(bytes: Uint8Array): WavPayload {
    if (bytes.length < 44 || readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 12) !== 'WAVE') {
        throw new Error('Downloaded file is not a complete RIFF/WAVE container');
    }

    let audioFormat = 0;
    let bitsPerSample = 0;
    let channels = 0;
    let dataBytes = 0;
    let dataOffset = 0;
    let sampleRate = 0;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const chunkId = readAscii(bytes, offset, offset + 4);
        const chunkSize = readUint32Le(bytes, offset + 4);
        const chunkDataOffset = offset + 8;
        const chunkEnd = chunkDataOffset + chunkSize;
        if (chunkEnd > bytes.length) {
            throw new Error(`Truncated ${chunkId} chunk`);
        }
        if (chunkId === 'fmt ') {
            if (chunkSize < 16) {
                throw new Error('Invalid WAV format chunk');
            }
            audioFormat = readUint16Le(bytes, chunkDataOffset);
            channels = readUint16Le(bytes, chunkDataOffset + 2);
            sampleRate = readUint32Le(bytes, chunkDataOffset + 4);
            bitsPerSample = readUint16Le(bytes, chunkDataOffset + 14);
        }
        if (chunkId === 'data') {
            dataBytes = chunkSize;
            dataOffset = chunkDataOffset;
        }
        offset = chunkEnd + (chunkSize % 2);
    }

    if (audioFormat !== 1 || channels === 0 || sampleRate === 0 || bitsPerSample !== 24 || dataBytes === 0) {
        throw new Error('Downloaded WAV is missing supported PCM format or audio data');
    }
    return { audioFormat, bitsPerSample, channels, dataBytes, dataOffset, sampleRate };
}

function readPcm24Sample(bytes: Uint8Array, offset: number): number {
    let sample = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
    if ((sample & PCM24_NEGATIVE_SCALE) !== 0) {
        sample -= PCM24_RANGE;
    }
    return sample;
}

function decodePcm24(bytes: Uint8Array, payload: WavPayload): DecodedPcm {
    const bytesPerSample = payload.bitsPerSample / 8;
    const frameBytes = payload.channels * bytesPerSample;
    if (payload.dataBytes % frameBytes !== 0) {
        throw new Error('Downloaded WAV data does not end on a complete sample frame');
    }

    const length = payload.dataBytes / frameBytes;
    const channelData = Array.from({ length: payload.channels }, () => new Float32Array(length));
    const dcSums = new Float64Array(payload.channels);
    let clippedSampleCount = 0;
    let samplePeak = 0;
    for (let frame = 0; frame < length; frame++) {
        for (let channel = 0; channel < payload.channels; channel++) {
            const offset = payload.dataOffset + frame * frameBytes + channel * bytesPerSample;
            const sample = readPcm24Sample(bytes, offset);
            if (sample === 0x7f_ffff || sample === -PCM24_NEGATIVE_SCALE) {
                clippedSampleCount++;
            }
            const normalized = sample / PCM24_NEGATIVE_SCALE;
            channelData[channel][frame] = normalized;
            dcSums[channel] += normalized;
            samplePeak = Math.max(samplePeak, Math.abs(normalized));
        }
    }

    return {
        channelData,
        clippedSampleCount,
        dcOffsets: Array.from(dcSums, (sum) => sum / length),
        length,
        samplePeak,
    };
}

function measureActiveBlockRatio(channels: readonly Float32Array[], length: number, sampleRate: number): number {
    const blockFrames = Math.round(ACTIVE_BLOCK_SECONDS * sampleRate);
    const blockCount = Math.ceil(length / blockFrames);
    let activeBlocks = 0;
    for (let block = 0; block < blockCount; block++) {
        const start = block * blockFrames;
        const end = Math.min(length, start + blockFrames);
        let sumSquares = 0;
        for (const channel of channels) {
            for (let frame = start; frame < end; frame++) {
                const sample = channel[frame];
                sumSquares += sample * sample;
            }
        }
        const rms = Math.sqrt(sumSquares / ((end - start) * channels.length));
        if (rms >= ACTIVE_BLOCK_RMS) {
            activeBlocks++;
        }
    }
    return activeBlocks / blockCount;
}

function measureLowFrequencyMono(
    channels: readonly Float32Array[],
    length: number,
    sampleRate: number
): {
    lowCorrelation: number;
    lowMonoCompatibilityDb: number;
} {
    const left = channels[0];
    const right = channels[1];
    const alpha = 1 - Math.exp((-2 * Math.PI * LOW_FREQUENCY_CUTOFF_HZ) / sampleRate);
    let filteredLeft = 0;
    let filteredRight = 0;
    let crossPower = 0;
    let leftPower = 0;
    let monoPower = 0;
    let rightPower = 0;
    for (let frame = 0; frame < length; frame++) {
        filteredLeft += alpha * (left[frame] - filteredLeft);
        filteredRight += alpha * (right[frame] - filteredRight);
        const mono = (filteredLeft + filteredRight) / 2;
        crossPower += filteredLeft * filteredRight;
        leftPower += filteredLeft * filteredLeft;
        monoPower += mono * mono;
        rightPower += filteredRight * filteredRight;
    }
    const stereoPower = (leftPower + rightPower) / 2;
    return {
        lowCorrelation: crossPower / Math.sqrt(leftPower * rightPower),
        lowMonoCompatibilityDb: 10 * Math.log10(monoPower / stereoPower),
    };
}

export function analyzePcmWav(bytes: Uint8Array): PcmWavAnalysis {
    const payload = findWavPayload(bytes);
    const decoded = decodePcm24(bytes, payload);
    const integratedLufs = measureIntegratedLoudness({
        channels: decoded.channelData,
        length: decoded.length,
        sampleRate: payload.sampleRate,
    });
    if (integratedLufs === null) {
        throw new Error('Downloaded WAV has no measurable integrated loudness');
    }
    const truePeak = measureTruePeak({ channels: decoded.channelData, length: decoded.length });
    const mono = measureLowFrequencyMono(decoded.channelData, decoded.length, payload.sampleRate);

    return {
        activeBlockRatio: measureActiveBlockRatio(decoded.channelData, decoded.length, payload.sampleRate),
        audioFormat: payload.audioFormat,
        bitsPerSample: payload.bitsPerSample,
        channels: payload.channels,
        clippedSampleCount: decoded.clippedSampleCount,
        dataBytes: payload.dataBytes,
        dcOffsets: decoded.dcOffsets,
        durationSeconds: decoded.length / payload.sampleRate,
        integratedLufs,
        ...mono,
        samplePeak: decoded.samplePeak,
        sampleRate: payload.sampleRate,
        truePeakDbTp: 20 * Math.log10(Math.max(truePeak, Number.MIN_VALUE)),
    };
}
