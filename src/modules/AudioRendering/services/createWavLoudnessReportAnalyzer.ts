import { createIntegratedLoudnessAccumulator } from '#/utils/audioMetering/measureIntegratedLoudness';
import { createMaxWindowedLoudnessAccumulator } from '#/utils/audioMetering/measureMaxWindowedLoudness';
import { createTruePeakAccumulator } from '#/utils/audioMetering/measureTruePeak';

import { type LoudnessReading, type WavLoudnessReport } from '../models/ExportLoudnessReport';

type WavShape = WavLoudnessReport['wav'];
type AudioShape = Omit<WavShape, 'frames' | 'bytes' | 'md5'>;
type Digest = { update: (bytes: Uint8Array) => void; digest: () => Uint8Array };
type WavFormat = { shape: AudioShape; fmtSize: number; headerLength: number };
type HeaderState = { bytes: Uint8Array; used: number; length: number };
const text = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const available = (value: number, unit: 'LUFS' | 'dBTP'): LoudnessReading => ({ value, unit });
const unavailable = (
    reason: 'empty' | 'short-window' | 'silence' | 'below-gate',
    unit: 'LUFS' | 'dBTP'
): LoudnessReading => ({ unavailable: reason, unit });

function readSampleRate(value: number): WavShape['sampleRate'] {
    if (value === 44100 || value === 48000 || value === 88200 || value === 96000) {
        return value;
    }
    throw new Error('Unsupported WAV report shape.');
}

function readBitDepth(value: number): WavShape['bitDepth'] {
    if (value === 16 || value === 24 || value === 32) {
        return value;
    }
    throw new Error('Unsupported WAV report shape.');
}

function validateEncoding(fmtSize: number, encoding: number, depth: number): void {
    if (
        (fmtSize !== 16 && fmtSize !== 18) ||
        (encoding !== 1 && encoding !== 3) ||
        (encoding === 1 && (fmtSize !== 16 || (depth !== 16 && depth !== 24))) ||
        (encoding === 3 && (fmtSize !== 18 || depth !== 32))
    ) {
        throw new Error('Unsupported WAV report shape.');
    }
}

function parseFormat(header: Uint8Array): WavFormat {
    if (text(header, 0, 4) !== 'RIFF' || text(header, 8, 16) !== 'WAVEfmt ') {
        throw new Error('Malformed WAV report input.');
    }
    const view = new DataView(header.buffer);
    const fmtSize = view.getUint32(16, true);
    const encoding = view.getUint16(20, true);
    const count = view.getUint16(22, true);
    const sampleRate = readSampleRate(view.getUint32(24, true));
    const bitDepth = readBitDepth(view.getUint16(34, true));
    validateEncoding(fmtSize, encoding, bitDepth);
    if (
        (count !== 1 && count !== 2) ||
        view.getUint16(32, true) !== (count * bitDepth) / 8 ||
        view.getUint32(28, true) !== (sampleRate * count * bitDepth) / 8
    ) {
        throw new Error('Unsupported WAV report shape.');
    }
    return {
        shape: { encoding: encoding === 1 ? 'PCM' : 'IEEE_FLOAT', channels: count, sampleRate, bitDepth },
        fmtSize,
        headerLength: 28 + fmtSize,
    };
}

function readDataLength(header: Uint8Array, format: WavFormat): number {
    const view = new DataView(header.buffer);
    if (format.fmtSize === 18 && view.getUint16(36, true) !== 0) {
        throw new Error('Malformed WAV extension.');
    }
    const chunkOffset = 20 + format.fmtSize;
    if (text(header, chunkOffset, chunkOffset + 4) !== 'data') {
        throw new Error('Missing WAV data chunk.');
    }
    const length = view.getUint32(chunkOffset + 4, true);
    const frameBytes = (format.shape.channels * format.shape.bitDepth) / 8;
    if (view.getUint32(4, true) !== format.headerLength + length - 8 || length % frameBytes !== 0) {
        throw new Error('Invalid WAV data length.');
    }
    return length;
}

function createAudioState(shape: AudioShape, dataLength: number, relativeGatePower?: number) {
    const sample = new Uint8Array(4);
    const sampleView = new DataView(sample.buffer);
    const channels = Array.from({ length: shape.channels }, () => new Float32Array(4096));
    const integrated = createIntegratedLoudnessAccumulator({
        numberOfChannels: shape.channels,
        sampleRate: shape.sampleRate,
        relativeGatePower,
    });
    let windows: ReturnType<typeof createMaxWindowedLoudnessAccumulator> | undefined;
    let truePeak: ReturnType<typeof createTruePeakAccumulator> | undefined;
    if (relativeGatePower !== undefined) {
        windows = createMaxWindowedLoudnessAccumulator({
            numberOfChannels: shape.channels,
            sampleRate: shape.sampleRate,
        });
        truePeak = createTruePeakAccumulator(shape.channels);
    }
    return {
        shape,
        dataLength,
        dataBytes: 0,
        sample,
        sampleView,
        sampleUsed: 0,
        channelIndex: 0,
        blockUsed: 0,
        channels,
        integrated,
        windows,
        truePeak,
    };
}

type AudioState = ReturnType<typeof createAudioState>;

function readHeaderByte(header: HeaderState, byte: number, relativeGatePower?: number): AudioState | undefined {
    if (header.used >= header.bytes.length) {
        throw new Error('Malformed WAV header.');
    }
    header.bytes[header.used++] = byte;
    if (header.used !== 44 && !(header.length === 46 && header.used === 46)) {
        return undefined;
    }
    const format = parseFormat(header.bytes);
    header.length = format.headerLength;
    if (header.used < header.length) {
        return undefined;
    }
    return createAudioState(format.shape, readDataLength(header.bytes, format), relativeGatePower);
}

function flushAudio(audio: AudioState): void {
    if (audio.blockUsed === 0) {
        return;
    }
    const block = audio.channels.map((channel) => channel.subarray(0, audio.blockUsed));
    audio.integrated.push(block);
    audio.windows?.push(block);
    audio.truePeak?.push(block);
    audio.blockUsed = 0;
}

function decodeSample(audio: AudioState): number {
    if (audio.shape.bitDepth === 16) {
        return audio.sampleView.getInt16(0, true) / 32768;
    }
    if (audio.shape.bitDepth === 24) {
        const raw = audio.sample[0]! | (audio.sample[1]! << 8) | (audio.sample[2]! << 16);
        return (raw >= 0x800000 ? raw - 0x1000000 : raw) / 8388608;
    }
    return audio.sampleView.getFloat32(0, true);
}

function readDataByte(audio: AudioState, byte: number): void {
    if (++audio.dataBytes > audio.dataLength) {
        throw new Error('WAV carries trailing bytes.');
    }
    audio.sample[audio.sampleUsed++] = byte;
    if (audio.sampleUsed < audio.shape.bitDepth / 8) {
        return;
    }
    const value = decodeSample(audio);
    if (!Number.isFinite(value)) {
        throw new TypeError('WAV report input has nonfinite audio.');
    }
    audio.channels[audio.channelIndex]![audio.blockUsed] = value;
    audio.sampleUsed = 0;
    audio.channelIndex++;
    if (audio.channelIndex === audio.shape.channels) {
        audio.channelIndex = 0;
        audio.blockUsed++;
        if (audio.blockUsed === 4096) {
            flushAudio(audio);
        }
    }
}

function windowReading(value: number | null, frames: number, windowFrames: number): LoudnessReading {
    if (value !== null) {
        return available(value, 'LUFS');
    }
    if (frames < windowFrames) {
        return unavailable(frames === 0 ? 'empty' : 'short-window', 'LUFS');
    }
    return unavailable('silence', 'LUFS');
}

function integratedReading(lufs: number | null, frames: number, sampleRate: number, peak?: number): LoudnessReading {
    if (lufs !== null) {
        return available(lufs, 'LUFS');
    }
    if (frames < Math.round(0.4 * sampleRate)) {
        return unavailable(frames === 0 ? 'empty' : 'short-window', 'LUFS');
    }
    return unavailable(peak === 0 ? 'silence' : 'below-gate', 'LUFS');
}

function finishAudio(audio: AudioState, byteCount: number, md5: Digest) {
    flushAudio(audio);
    const { shape } = audio;
    const frames = audio.dataLength / ((shape.channels * shape.bitDepth) / 8);
    const identity: WavShape = { ...shape, frames, bytes: byteCount, md5: hex(md5.digest()) };
    const gate = audio.integrated.relativeGatePower();
    const lufs = audio.integrated.integratedLufs();
    let readings: readonly [number | null, number | null] = [null, null];
    if (audio.windows) {
        readings = audio.windows.finish();
    }
    const [momentary, shortTerm] = readings;
    const peak = audio.truePeak?.finish();
    let truePeakReading: LoudnessReading;
    if (peak === undefined || peak === 0) {
        truePeakReading = unavailable(frames === 0 ? 'empty' : 'silence', 'dBTP');
    } else {
        truePeakReading = available(20 * Math.log10(peak), 'dBTP');
    }
    return {
        wav: identity,
        relativeGatePower: gate,
        integrated: integratedReading(lufs, frames, shape.sampleRate, peak),
        maxMomentary: windowReading(momentary, frames, Math.round(0.4 * shape.sampleRate)),
        maxShortTerm: windowReading(shortTerm, frames, Math.round(3 * shape.sampleRate)),
        truePeak: truePeakReading,
    };
}

/** Consumes exact emitted RIFF bytes synchronously, before its caller acknowledges a writer block. */
export function createWavLoudnessReportAnalyzer(md5: Digest, relativeGatePower?: number) {
    const header: HeaderState = { bytes: new Uint8Array(46), used: 0, length: 0 };
    let audio: AudioState | undefined;
    let byteCount = 0;
    return {
        write(bytes: Uint8Array) {
            if (byteCount + bytes.length > 0xffffffff + 8) {
                throw new Error('WAV report exceeds RIFF32.');
            }
            md5.update(bytes);
            byteCount += bytes.length;
            for (const byte of bytes) {
                if (audio) {
                    readDataByte(audio, byte);
                } else {
                    audio = readHeaderByte(header, byte, relativeGatePower);
                }
            }
        },
        finish() {
            if (
                !audio ||
                byteCount !== header.length + audio.dataLength ||
                audio.dataBytes !== audio.dataLength ||
                audio.sampleUsed ||
                audio.channelIndex
            ) {
                throw new Error('Incomplete WAV report input.');
            }
            return finishAudio(audio, byteCount, md5);
        },
    };
}
