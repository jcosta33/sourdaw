import { type ExportAudioSource, type ExportByteWriter } from '../../models/ExportAudioSource';

import { type PcmDitherOptions } from './convertFloatChannelsToPcm';
import { createPcmBlockReader } from './createPcmBlockReader';
import { createIncrementalMd5 } from './createIncrementalMd5';

const CRC8_POLY = 0x07;
const CRC16_POLY = 0x8005;

function buildCrc8Table(): Uint8Array {
    const table = new Uint8Array(256);
    for (let index = 0; index < 256; index++) {
        let crc = index;
        for (let jIndex = 0; jIndex < 8; jIndex++) {
            crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ CRC8_POLY) & 0xff : (crc << 1) & 0xff;
        }
        table[index] = crc;
    }
    return table;
}

function buildCrc16Table(): Uint16Array {
    const table = new Uint16Array(256);
    for (let index = 0; index < 256; index++) {
        let crc = index << 8;
        for (let jIndex = 0; jIndex < 8; jIndex++) {
            crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ CRC16_POLY) & 0xffff : (crc << 1) & 0xffff;
        }
        table[index] = crc;
    }
    return table;
}

const CRC8_TABLE = buildCrc8Table();
const CRC16_TABLE = buildCrc16Table();

function crc8(data: Uint8Array, start: number, end: number): number {
    let crc = 0;
    for (let index = start; index < end; index++) {
        crc = CRC8_TABLE[crc ^ data[index]!]!;
    }
    return crc;
}

function crc16(data: Uint8Array, start: number, end: number): number {
    let crc = 0;
    for (let index = start; index < end; index++) {
        crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ data[index]!) & 0xff]!) & 0xffff;
    }
    return crc;
}

function encodeUtf8Number(node: number): number[] {
    if (node < 0x80) {
        return [node];
    }
    if (node < 0x800) {
        return [0xc0 | (node >> 6), 0x80 | (node & 0x3f)];
    }
    if (node < 0x10000) {
        return [0xe0 | (node >> 12), 0x80 | ((node >> 6) & 0x3f), 0x80 | (node & 0x3f)];
    }
    if (node < 0x200000) {
        return [0xf0 | (node >> 18), 0x80 | ((node >> 12) & 0x3f), 0x80 | ((node >> 6) & 0x3f), 0x80 | (node & 0x3f)];
    }
    if (node < 0x4000000) {
        return [
            0xf8 | (node >> 24),
            0x80 | ((node >> 18) & 0x3f),
            0x80 | ((node >> 12) & 0x3f),
            0x80 | ((node >> 6) & 0x3f),
            0x80 | (node & 0x3f),
        ];
    }
    return [
        0xfc | (node >> 30),
        0x80 | ((node >> 24) & 0x3f),
        0x80 | ((node >> 18) & 0x3f),
        0x80 | ((node >> 12) & 0x3f),
        0x80 | ((node >> 6) & 0x3f),
        0x80 | (node & 0x3f),
    ];
}

const FLAC_BLOCK_SIZE = 4096;

/**
 * Bit depths this encoder can actually write. 32-bit float has no lossless
 * FLAC representation here, so it is rejected rather than silently downgraded
 * (OE-8) — the export UI must not offer what the encoder cannot deliver.
 */
export type FlacBitDepth = 16 | 24;

/** FLAC frame-header SAMPLE SIZE codes (spec §9.1.5). */
const SAMPLE_SIZE_CODES: Record<FlacBitDepth, number> = { 16: 0x4, 24: 0x6 };

// ── Bit writer (MSB-first) ────────────────────────────────────────────────────

class BitWriter {
    readonly buf: Uint8Array;
    pos: number;
    private bit: number; // current bit offset within buf[pos], 0 = MSB

    constructor(buf: Uint8Array, startPos: number) {
        this.buf = buf;
        this.pos = startPos;
        this.bit = 0;
        this.buf[this.pos] = 0;
    }

    writeBit(value: 0 | 1): void {
        if (value) {
            this.buf[this.pos]! |= 0x80 >> this.bit;
        }
        if (++this.bit === 8) {
            this.bit = 0;
            this.buf[++this.pos] = 0;
        }
    }

    writeBits(value: number, node: number): void {
        for (let index = node - 1; index >= 0; index--) {
            this.writeBit(((value >> index) & 1) as 0 | 1);
        }
    }

    writeByte(value: number): void {
        if (this.bit === 0) {
            this.buf[this.pos++] = value & 0xff;
            this.buf[this.pos] = 0;
        } else {
            this.writeBits(value, 8);
        }
    }

    writeBe16(value: number): void {
        this.writeByte((value >> 8) & 0xff);
        this.writeByte(value & 0xff);
    }

    /** FLAC Rice quotient: zero bits terminated by one (RFC 9639). */
    writeUnary(node: number): void {
        for (let index = 0; index < node; index++) {
            this.writeBit(0);
        }
        this.writeBit(1);
    }

    /** Pad to next byte boundary with zero bits. */
    flush(): void {
        if (this.bit > 0) {
            this.bit = 0;
            this.pos++;
            this.buf[this.pos] = 0;
        }
    }
}

// ── FIXED predictor helpers ───────────────────────────────────────────────────

/** Bit mask for one signed sample written verbatim at the stream's bit depth. */
function sampleMask(bitsPerSample: number): number {
    return 2 ** bitsPerSample - 1;
}

/** Compute FIXED predictor residuals for a single block.
 *  Coefficients per FLAC spec §10:
 *    order 0: pred = 0
 *    order 1: pred = s[n-1]
 *    order 2: pred = 2*s[n-1] - s[n-2]
 *    order 3: pred = 3*s[n-1] - 3*s[n-2] + s[n-3]
 *    order 4: pred = 4*s[n-1] - 6*s[n-2] + 4*s[n-3] - s[n-4]
 */
function fixedResiduals(int16: Int32Array, blockStart: number, blockSize: number, order: number): Int32Array {
    const count = blockSize - order;
    const res = new Int32Array(count);
    for (let index = 0; index < count; index++) {
        const node = blockStart + order + index;
        let pred: number;
        switch (order) {
            case 0:
                pred = 0;
                break;
            case 1:
                pred = int16[node - 1]!;
                break;
            case 2:
                pred = 2 * int16[node - 1]! - int16[node - 2]!;
                break;
            case 3:
                pred = 3 * int16[node - 1]! - 3 * int16[node - 2]! + int16[node - 3]!;
                break;
            default:
                pred = 4 * int16[node - 1]! - 6 * int16[node - 2]! + 4 * int16[node - 3]! - int16[node - 4]!;
                break;
        }
        res[index] = int16[node]! - pred;
    }
    return res;
}

/** Choose the optimal Rice parameter k for an array of residuals. */
function bestRiceK(res: Int32Array, start: number, count: number): number {
    if (count === 0) {
        return 0;
    }
    let sum = 0;
    for (let index = 0; index < count; index++) {
        const r = res[start + index]!;
        sum += r >= 0 ? 2 * r : -2 * r - 1; // zigzag to unsigned
    }
    const mean = sum / count;
    if (mean < 1) {
        return 0;
    }
    return Math.min(14, Math.floor(Math.log2(mean)));
}

/** Exact Rice-coded bit count for a residual array with parameter k. */
function riceBits(res: Int32Array, start: number, count: number, kIndex: number): number {
    let bits = 0;
    for (let index = 0; index < count; index++) {
        const r = res[start + index]!;
        const user = r >= 0 ? 2 * r : -2 * r - 1;
        bits += (user >> kIndex) + 1 + kIndex;
    }
    return bits;
}

/** Total bit cost for a FIXED subframe (header + warmup + Rice residuals). */
function fixedSubframeBits(res: Int32Array, residualCount: number, order: number, bitsPerSample: number): number {
    // 8 (header) + order*bps (warmup) + 2 (coding method) + 4 (partition order) + 4 (rice k) + rice bits
    const kIndex = bestRiceK(res, 0, residualCount);
    return 8 + order * bitsPerSample + 2 + 4 + 4 + riceBits(res, 0, residualCount, kIndex);
}

/** Total bit cost for a verbatim subframe. */
function verbatimSubframeBits(blockSize: number, bitsPerSample: number): number {
    return 8 + blockSize * bitsPerSample;
}

// ── Subframe writers ──────────────────────────────────────────────────────────

function writeSubframeVerbatim(
    bw: BitWriter,
    samples: Int32Array,
    blockStart: number,
    blockSize: number,
    bitsPerSample: number
): void {
    bw.writeByte(0x02); // subframe type: verbatim, no wasted bits
    const mask = sampleMask(bitsPerSample);
    for (let index = 0; index < blockSize; index++) {
        bw.writeBits(samples[blockStart + index]! & mask, bitsPerSample);
    }
}

function writeSubframeFixed(
    bw: BitWriter,
    samples: Int32Array,
    blockStart: number,
    blockSize: number,
    order: number,
    res: Int32Array,
    bitsPerSample: number
): void {
    // Subframe header: 0 | 001kkk0 where kkk = order (FIXED predictor, no wasted bits)
    bw.writeByte((8 + order) << 1);
    // Warmup samples (verbatim at full bitsPerSample)
    const mask = sampleMask(bitsPerSample);
    for (let index = 0; index < order; index++) {
        bw.writeBits(samples[blockStart + index]! & mask, bitsPerSample);
    }
    const residualCount = blockSize - order;
    // Residual coding: PARTITIONED_RICE, partition order 0 (single partition)
    bw.writeBits(0, 2); // coding method: PARTITIONED_RICE
    bw.writeBits(0, 4); // partition order: 0
    const kIndex = bestRiceK(res, 0, residualCount);
    bw.writeBits(kIndex, 4); // Rice parameter
    // Rice-encode residuals
    for (let index = 0; index < residualCount; index++) {
        const r = res[index]!;
        const user = r >= 0 ? 2 * r : -2 * r - 1; // zigzag
        bw.writeUnary(user >> kIndex);
        if (kIndex > 0) {
            bw.writeBits(user & ((1 << kIndex) - 1), kIndex);
        }
    }
}

/** Pick and write the best subframe (FIXED or verbatim) for one channel block. */
function encodeSubframe(
    bw: BitWriter,
    samples: Int32Array,
    blockStart: number,
    blockSize: number,
    bitsPerSample: number
): void {
    let bestOrder = -1; // -1 = use verbatim
    let bestBits = verbatimSubframeBits(blockSize, bitsPerSample);
    let bestRes: Int32Array | null = null;

    for (let order = 0; order <= 4; order++) {
        // Predictor order must not exceed available warm-up samples
        if (order > blockSize) {
            break;
        }
        const res = fixedResiduals(samples, blockStart, blockSize, order);
        const bits = fixedSubframeBits(res, blockSize - order, order, bitsPerSample);
        if (bits < bestBits) {
            bestBits = bits;
            bestOrder = order;
            bestRes = res;
        }
    }

    if (bestOrder >= 0 && bestRes !== null) {
        writeSubframeFixed(bw, samples, blockStart, blockSize, bestOrder, bestRes, bitsPerSample);
    } else {
        writeSubframeVerbatim(bw, samples, blockStart, blockSize, bitsPerSample);
    }
}

export function audioBufferToFlac(
    buffer: ExportAudioSource,
    bitDepth: FlacBitDepth,
    onProgress: ((frac: number) => void) | undefined,
    dither: PcmDitherOptions | undefined,
    writer: ExportByteWriter
): Promise<void>;
export function audioBufferToFlac(
    buffer: ExportAudioSource,
    bitDepth?: FlacBitDepth,
    onProgress?: (frac: number) => void,
    dither?: PcmDitherOptions
): Promise<Uint8Array>;
/** MD5 is complete before STREAMINFO is emitted, then the exact seeded PCM is replayed by frame. */
export async function audioBufferToFlac(
    buffer: ExportAudioSource,
    bitsPerSample: FlacBitDepth = 16,
    onProgress?: (frac: number) => void,
    dither?: PcmDitherOptions,
    writer?: ExportByteWriter
): Promise<Uint8Array | void> {
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const sampleRate = buffer.sampleRate;
    const totalSamples = buffer.length;
    const bytesPerSample = bitsPerSample / 8;
    if (
        ![16, 24].includes(bitsPerSample) ||
        !Number.isInteger(sampleRate) ||
        sampleRate < 1 ||
        sampleRate > 655350 ||
        !Number.isSafeInteger(totalSamples) ||
        totalSamples < 1 ||
        totalSamples > 0xfffffffff ||
        numChannels < 1
    ) {
        throw new Error('FLAC export settings exceed the stream format limits.');
    }
    const first = createPcmBlockReader({ source: buffer, bitDepth: bitsPerSample, dither, channelLimit: 2 });
    const replayDither: PcmDitherOptions = { mode: dither?.mode ?? 'tpdf', seed: first.seed };
    const md5 = createIncrementalMd5();
    for (let start = 0; start < totalSamples; start += FLAC_BLOCK_SIZE) {
        writer?.checkCancelled?.();
        const block = first.read(FLAC_BLOCK_SIZE);
        const bytes = new Uint8Array(block.length * numChannels * bytesPerSample);
        let offset = 0;
        for (let frame = 0; frame < block.length; frame++) {
            for (const channel of block.channels) {
                const sample = channel[frame]!;
                for (let byte = 0; byte < bytesPerSample; byte++) {
                    bytes[offset++] = (sample >> (byte * 8)) & 0xff;
                }
            }
        }
        md5.update(bytes);
        if ((start + block.length) % (FLAC_BLOCK_SIZE * 16) === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
    }
    const chunks: Uint8Array[] = [];
    const destination = writer ?? {
        write: async (bytes: Uint8Array) => {
            chunks.push(bytes);
        },
    };
    const header = new Uint8Array(42);
    header.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]);
    const headerView = new DataView(header.buffer);
    // Fixed-block streams declare their nominal size; the final short frame is excluded.
    headerView.setUint16(8, FLAC_BLOCK_SIZE);
    headerView.setUint16(10, FLAC_BLOCK_SIZE);
    const streamShape =
        (BigInt(sampleRate) << 44n) |
        (BigInt(numChannels - 1) << 41n) |
        (BigInt(bitsPerSample - 1) << 36n) |
        BigInt(totalSamples);
    headerView.setBigUint64(18, streamShape);
    header.set(md5.digest(), 26);
    destination.checkCancelled?.();
    await destination.write(header);
    const pcm = createPcmBlockReader({
        source: buffer,
        bitDepth: bitsPerSample,
        dither: replayDither,
        channelLimit: 2,
    });
    const maxFrameBytes = 20 + numChannels * (FLAC_BLOCK_SIZE * bytesPerSample + 4) + 2;
    let frameNumber = 0;
    for (let start = 0; start < totalSamples; start += FLAC_BLOCK_SIZE) {
        destination.checkCancelled?.();
        const block = pcm.read(FLAC_BLOCK_SIZE);
        const out = new Uint8Array(maxFrameBytes);
        let pos = 0;
        const wb = (value: number) => {
            out[pos++] = value & 0xff;
        };
        const wbe16 = (value: number) => {
            wb(value >> 8);
            wb(value);
        };
        wbe16(0xfff8);
        let blockSizeCode = 7;
        if (block.length === FLAC_BLOCK_SIZE) {
            blockSizeCode = 0xc;
        } else if (block.length <= 256) {
            blockSizeCode = 6;
        }
        wb(blockSizeCode << 4);
        wb(((numChannels - 1) << 4) | (SAMPLE_SIZE_CODES[bitsPerSample] << 1));
        for (const byte of encodeUtf8Number(frameNumber)) {
            wb(byte);
        }
        if (blockSizeCode === 6) {
            wb(block.length - 1);
        } else if (blockSizeCode === 7) {
            wbe16(block.length - 1);
        }
        wb(crc8(out, 0, pos));
        const bw = new BitWriter(out, pos);
        for (const channel of block.channels) {
            if (!(channel instanceof Int32Array)) {
                throw new Error('FLAC requires integer PCM.');
            }
            encodeSubframe(bw, channel, 0, block.length, bitsPerSample);
        }
        bw.flush();
        pos = bw.pos;
        wbe16(crc16(out, 0, pos));
        await destination.write(out.subarray(0, pos));
        frameNumber++;
        onProgress?.((start + block.length) / totalSamples);
        if (frameNumber % 16 === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
    }
    destination.checkCancelled?.();
    onProgress?.(1);
    if (!writer) {
        const result = new Uint8Array(chunks.reduce((sum, bytes) => sum + bytes.length, 0));
        let offset = 0;
        for (const bytes of chunks) {
            result.set(bytes, offset);
            offset += bytes.length;
        }
        return result;
    }
}
