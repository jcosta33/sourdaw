import { type LoudnessReading, type WavLoudnessReport } from '../models/ExportLoudnessReport';

import { createIntegratedLoudnessAccumulator } from '#/utils/audioMetering/measureIntegratedLoudness';
import { createMaxWindowedLoudnessAccumulator } from '#/utils/audioMetering/measureMaxWindowedLoudness';
import { createTruePeakAccumulator } from '#/utils/audioMetering/measureTruePeak';

type WavShape = WavLoudnessReport['wav'];
const RATES = [44100, 48000, 88200, 96000];
const text = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const available = (value: number, unit: 'LUFS' | 'dBTP'): LoudnessReading => ({ value, unit });
const unavailable = (
    reason: 'empty' | 'short-window' | 'silence' | 'below-gate',
    unit: 'LUFS' | 'dBTP'
): LoudnessReading => ({ unavailable: reason, unit });

/** Consumes exact emitted RIFF bytes synchronously, before its caller acknowledges a writer block. */
export function createWavLoudnessReportAnalyzer(
    md5: { update: (bytes: Uint8Array) => void; digest: () => Uint8Array },
    relativeGatePower?: number
) {
    const header = new Uint8Array(46);
    const sample = new Uint8Array(4);
    const sampleView = new DataView(sample.buffer);
    let headerUsed = 0;
    let headerLength = 0;
    let dataLength = 0;
    let byteCount = 0;
    let dataBytes = 0;
    let sampleUsed = 0;
    let channelIndex = 0;
    let blockUsed = 0;
    let shape: Omit<WavShape, 'frames' | 'bytes' | 'md5'> | undefined;
    let channels: Float32Array[] = [];
    let integrated: ReturnType<typeof createIntegratedLoudnessAccumulator> | undefined;
    let windows: ReturnType<typeof createMaxWindowedLoudnessAccumulator> | undefined;
    let truePeak: ReturnType<typeof createTruePeakAccumulator> | undefined;
    const flush = () => {
        if (blockUsed === 0) return;
        const block = channels.map((channel) => channel.subarray(0, blockUsed));
        integrated!.push(block);
        windows?.push(block);
        truePeak?.push(block);
        blockUsed = 0;
    };
    const parseHeader = () => {
        const view = new DataView(header.buffer);
        if (text(header, 0, 4) !== 'RIFF' || text(header, 8, 16) !== 'WAVEfmt ')
            throw new Error('Malformed WAV report input.');
        const fmtSize = view.getUint32(16, true);
        const encoding = view.getUint16(20, true);
        const count = view.getUint16(22, true);
        const rate = view.getUint32(24, true);
        const depth = view.getUint16(34, true);
        if (
            (fmtSize !== 16 && fmtSize !== 18) ||
            (encoding !== 1 && encoding !== 3) ||
            (encoding === 1 && (fmtSize !== 16 || (depth !== 16 && depth !== 24))) ||
            (encoding === 3 && (fmtSize !== 18 || depth !== 32)) ||
            (count !== 1 && count !== 2) ||
            !RATES.includes(rate) ||
            view.getUint16(32, true) !== (count * depth) / 8 ||
            view.getUint32(28, true) !== (rate * count * depth) / 8
        ) {
            throw new Error('Unsupported WAV report shape.');
        }
        headerLength = 28 + fmtSize;
        if (headerUsed < headerLength) return;
        if (fmtSize === 18 && view.getUint16(36, true) !== 0) throw new Error('Malformed WAV extension.');
        const chunkOffset = 20 + fmtSize;
        if (text(header, chunkOffset, chunkOffset + 4) !== 'data') throw new Error('Missing WAV data chunk.');
        dataLength = view.getUint32(chunkOffset + 4, true);
        if (view.getUint32(4, true) !== headerLength + dataLength - 8 || dataLength % ((count * depth) / 8) !== 0)
            throw new Error('Invalid WAV data length.');
        shape = {
            encoding: encoding === 1 ? 'PCM' : 'IEEE_FLOAT',
            channels: count === 1 ? 1 : 2,
            sampleRate: rate === 44100 ? 44100 : rate === 48000 ? 48000 : rate === 88200 ? 88200 : 96000,
            bitDepth: depth === 16 ? 16 : depth === 24 ? 24 : 32,
        };
        channels = Array.from({ length: count }, () => new Float32Array(4096));
        integrated = createIntegratedLoudnessAccumulator({
            numberOfChannels: count,
            sampleRate: rate,
            relativeGatePower,
        });
        if (relativeGatePower !== undefined) {
            windows = createMaxWindowedLoudnessAccumulator({ numberOfChannels: count, sampleRate: rate });
            truePeak = createTruePeakAccumulator(count);
        }
    };
    return {
        write(bytes: Uint8Array) {
            if (byteCount + bytes.length > 0xffffffff + 8) throw new Error('WAV report exceeds RIFF32.');
            md5.update(bytes);
            byteCount += bytes.length;
            for (const byte of bytes) {
                if (!shape) {
                    if (headerUsed >= header.length) throw new Error('Malformed WAV header.');
                    header[headerUsed++] = byte;
                    if (headerUsed === 44 || (headerLength === 46 && headerUsed === 46)) parseHeader();
                    continue;
                }
                if (++dataBytes > dataLength) throw new Error('WAV carries trailing bytes.');
                sample[sampleUsed++] = byte;
                if (sampleUsed < shape.bitDepth / 8) continue;
                let value: number;
                if (shape.bitDepth === 16) value = sampleView.getInt16(0, true) / 32768;
                else if (shape.bitDepth === 24) {
                    const raw = sample[0]! | (sample[1]! << 8) | (sample[2]! << 16);
                    value = (raw >= 0x800000 ? raw - 0x1000000 : raw) / 8388608;
                } else value = sampleView.getFloat32(0, true);
                if (!Number.isFinite(value)) throw new Error('WAV report input has nonfinite audio.');
                channels[channelIndex]![blockUsed] = value;
                sampleUsed = 0;
                channelIndex++;
                if (channelIndex === shape.channels) {
                    channelIndex = 0;
                    blockUsed++;
                    if (blockUsed === 4096) flush();
                }
            }
        },
        finish() {
            if (
                !shape ||
                byteCount !== headerLength + dataLength ||
                dataBytes !== dataLength ||
                sampleUsed ||
                channelIndex
            ) {
                throw new Error('Incomplete WAV report input.');
            }
            flush();
            const frames = dataLength / ((shape.channels * shape.bitDepth) / 8);
            const identity: WavShape = { ...shape, frames, bytes: byteCount, md5: hex(md5.digest()) };
            const gate = integrated!.relativeGatePower();
            const lufs = integrated!.integratedLufs();
            const [momentary, shortTerm] = windows?.finish() ?? [null, null];
            const peak = truePeak?.finish();
            const reason = frames === 0 ? 'empty' : 'silence';
            const reading = (value: number | null, windowFrames: number): LoudnessReading =>
                value === null
                    ? unavailable(frames < windowFrames ? (frames === 0 ? 'empty' : 'short-window') : 'silence', 'LUFS')
                    : available(value, 'LUFS');
            return {
                wav: identity,
                relativeGatePower: gate,
                integrated:
                    lufs === null
                        ? unavailable(
                              frames < Math.round(0.4 * shape.sampleRate)
                                  ? frames === 0
                                      ? 'empty'
                                      : 'short-window'
                                  : peak === 0
                                    ? 'silence'
                                    : 'below-gate',
                              'LUFS'
                          )
                        : available(lufs, 'LUFS'),
                maxMomentary: reading(momentary, Math.round(0.4 * shape.sampleRate)),
                maxShortTerm: reading(shortTerm, Math.round(3 * shape.sampleRate)),
                truePeak:
                    peak === undefined || peak === 0
                        ? unavailable(reason, 'dBTP')
                        : available(20 * Math.log10(peak), 'dBTP'),
            };
        },
    };
}
