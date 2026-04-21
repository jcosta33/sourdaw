/**
 * FLAC encoder — FIXED linear predictor subframes (orders 0–4) with
 * partitioned Rice coding, 16-bit signed PCM, up to 2 channels.
 * Falls back to verbatim per-block when prediction would be larger.
 */

// ── Compact MD5 implementation ────────────────────────────────────────────────
// Used to compute the STREAMINFO MD5 signature of the raw interleaved PCM data.
// Based on RFC 1321. Pure TypeScript, no dependencies.

const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
    21,
];

const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
    MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
}

function md5(data: Uint8Array): Uint8Array {
    const msgLen = data.length;
    // Pad to 512-bit (64-byte) blocks: append 0x80, zeros, then length in bits as 64-bit LE
    const padLen = ((msgLen + 8) & ~63) + 56 - msgLen;
    const padded = new Uint8Array(msgLen + padLen + 8);
    padded.set(data);
    padded[msgLen] = 0x80;
    // Append original length in bits as 64-bit LE (only low 32 bits matter for audio)
    const bitLen = msgLen * 8;
    padded[msgLen + padLen] = bitLen & 0xff;
    padded[msgLen + padLen + 1] = (bitLen >>> 8) & 0xff;
    padded[msgLen + padLen + 2] = (bitLen >>> 16) & 0xff;
    padded[msgLen + padLen + 3] = (bitLen >>> 24) & 0xff;

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    const view = new DataView(padded.buffer);
    for (let off = 0; off < padded.length; off += 64) {
        const M = new Uint32Array(16);
        for (let jIndex = 0; jIndex < 16; jIndex++) {
            M[jIndex] = view.getUint32(off + jIndex * 4, true);
        }

        let A = a0,
            B = b0,
            C = c0,
            D = d0;

        for (let index = 0; index < 64; index++) {
            let F: number, g: number;
            if (index < 16) {
                F = (B & C) | (~B & D);
                g = index;
            } else if (index < 32) {
                F = (D & B) | (~D & C);
                g = (5 * index + 1) & 15;
            } else if (index < 48) {
                F = B ^ C ^ D;
                g = (3 * index + 5) & 15;
            } else {
                F = C ^ (B | ~D);
                g = (7 * index) & 15;
            }
            F = (F + A + MD5_K[index]! + M[g]!) >>> 0;
            A = D;
            D = C;
            C = B;
            const rot = MD5_S[index]!;
            B = (B + ((F << rot) | (F >>> (32 - rot)))) >>> 0;
        }

        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
    }

    const result = new Uint8Array(16);
    const rv = new DataView(result.buffer);
    rv.setUint32(0, a0, true);
    rv.setUint32(4, b0, true);
    rv.setUint32(8, c0, true);
    rv.setUint32(12, d0, true);
    return result;
}

/** Compute FLAC STREAMINFO MD5: interleaved, little-endian int16 samples. */
function computePcmMd5(channels: Float32Array[], totalSamples: number, numChannels: number): Uint8Array {
    const pcm = new Uint8Array(totalSamples * numChannels * 2);
    const view = new DataView(pcm.buffer);
    let pos = 0;
    for (let index = 0; index < totalSamples; index++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch]![index]!));
            const int16 = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
            view.setInt16(pos, int16, true); // little-endian
            pos += 2;
        }
    }
    return md5(pcm);
}

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
const BITS_PER_SAMPLE = 16;

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

    /** Write `n` one-bits then a zero-bit (unary coding). */
    writeUnary(node: number): void {
        for (let index = 0; index < node; index++) {
            this.writeBit(1);
        }
        this.writeBit(0);
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

/** Convert float32 channel data to int16 values stored in an Int32Array. */
function toInt16Channel(floats: Float32Array, node: number): Int32Array {
    const out = new Int32Array(node);
    for (let index = 0; index < node; index++) {
        const state = floats[index]! < -1 ? -1 : floats[index]! > 1 ? 1 : floats[index]!;
        out[index] = state < 0 ? Math.round(state * 0x8000) : Math.round(state * 0x7fff);
    }
    return out;
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
function fixedSubframeBits(res: Int32Array, residualCount: number, order: number): number {
    // 8 (header) + order*16 (warmup) + 2 (coding method) + 4 (partition order) + 4 (rice k) + rice bits
    const kIndex = bestRiceK(res, 0, residualCount);
    return 8 + order * BITS_PER_SAMPLE + 2 + 4 + 4 + riceBits(res, 0, residualCount, kIndex);
}

/** Total bit cost for a verbatim subframe. */
function verbatimSubframeBits(blockSize: number): number {
    return 8 + blockSize * BITS_PER_SAMPLE;
}

// ── Subframe writers ──────────────────────────────────────────────────────────

function writeSubframeVerbatim(bw: BitWriter, int16: Int32Array, blockStart: number, blockSize: number): void {
    bw.writeByte(0x02); // subframe type: verbatim, no wasted bits
    for (let index = 0; index < blockSize; index++) {
        bw.writeBits(int16[blockStart + index]! & 0xffff, BITS_PER_SAMPLE);
    }
}

function writeSubframeFixed(
    bw: BitWriter,
    int16: Int32Array,
    blockStart: number,
    blockSize: number,
    order: number,
    res: Int32Array
): void {
    // Subframe header: 0 | 001kkk0 where kkk = order (FIXED predictor, no wasted bits)
    bw.writeByte((8 + order) << 1);
    // Warmup samples (verbatim at full bitsPerSample)
    for (let index = 0; index < order; index++) {
        bw.writeBits(int16[blockStart + index]! & 0xffff, BITS_PER_SAMPLE);
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
function encodeSubframe(bw: BitWriter, int16: Int32Array, blockStart: number, blockSize: number): void {
    let bestOrder = -1; // -1 = use verbatim
    let bestBits = verbatimSubframeBits(blockSize);
    let bestRes: Int32Array | null = null;

    for (let order = 0; order <= 4; order++) {
        // Predictor order must not exceed available warm-up samples
        if (order > blockSize) {
            break;
        }
        const res = fixedResiduals(int16, blockStart, blockSize, order);
        const bits = fixedSubframeBits(res, blockSize - order, order);
        if (bits < bestBits) {
            bestBits = bits;
            bestOrder = order;
            bestRes = res;
        }
    }

    if (bestOrder >= 0 && bestRes !== null) {
        writeSubframeFixed(bw, int16, blockStart, blockSize, bestOrder, bestRes);
    } else {
        writeSubframeVerbatim(bw, int16, blockStart, blockSize);
    }
}

// ── Main encoder ──────────────────────────────────────────────────────────────

async function encodeFlac(buffer: AudioBuffer, onProgress?: (frac: number) => void): Promise<Uint8Array> {
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const sampleRate = buffer.sampleRate;
    const totalSamples = buffer.length;

    const floatChannels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        floatChannels.push(buffer.getChannelData(ch));
    }

    // Pre-convert all channels to int16 for predictor residual computation
    const int16Channels = floatChannels.map((ch) => toInt16Channel(ch, totalSamples));

    // MD5 over interleaved LE int16 PCM
    const pcmMd5 = computePcmMd5(floatChannels, totalSamples, numChannels);

    const frameCount = Math.ceil(totalSamples / FLAC_BLOCK_SIZE);
    // Budget: worst case is verbatim (FIXED never exceeds verbatim since we fall back).
    // Add small per-frame padding for Rice overhead and byte-alignment.
    const maxFrameBytes = 20 + numChannels * (FLAC_BLOCK_SIZE * 2 + 4) + 2;
    const out = new Uint8Array(42 + frameCount * maxFrameBytes);

    // ── STREAMINFO ────────────────────────────────────────────────────────────
    let pos = 0;
    function wb(b: number) {
        out[pos++] = b & 0xff;
    }
    function wbe16(value: number) {
        out[pos++] = (value >> 8) & 0xff;
        out[pos++] = value & 0xff;
    }
    function wbe24(value: number) {
        out[pos++] = (value >> 16) & 0xff;
        out[pos++] = (value >> 8) & 0xff;
        out[pos++] = value & 0xff;
    }

    out[pos++] = 0x66;
    out[pos++] = 0x4c;
    out[pos++] = 0x61;
    out[pos++] = 0x43; // "fLaC"
    wb(0x80);
    wbe24(34); // last-metadata-block flag + STREAMINFO length
    wbe16(FLAC_BLOCK_SIZE);
    wbe16(FLAC_BLOCK_SIZE); // min/max block size
    wbe24(0);
    wbe24(0); // min/max frame size (unknown)
    wb((sampleRate >> 12) & 0xff);
    wb((sampleRate >> 4) & 0xff);
    wb(((sampleRate & 0xf) << 4) | ((numChannels - 1) << 1) | ((BITS_PER_SAMPLE - 1) >> 4));
    wb((((BITS_PER_SAMPLE - 1) & 0xf) << 4) | ((totalSamples >> 32) & 0xf));
    out[pos++] = (totalSamples >>> 24) & 0xff;
    out[pos++] = (totalSamples >>> 16) & 0xff;
    out[pos++] = (totalSamples >>> 8) & 0xff;
    out[pos++] = totalSamples & 0xff;
    for (let index = 0; index < 16; index++) {
        wb(pcmMd5[index]!);
    }

    // ── Frames ────────────────────────────────────────────────────────────────
    let sampleOffset = 0;
    let frameNumber = 0;

    while (sampleOffset < totalSamples) {
        const blockSize = Math.min(FLAC_BLOCK_SIZE, totalSamples - sampleOffset);
        const frameStart = pos;

        // Frame sync + header
        wbe16(0xfff8);
        let blockSizeCode: number;
        let blockSizeExtra = 0;
        if (blockSize === 4096) {
            blockSizeCode = 0xc;
        } else if (blockSize <= 255) {
            blockSizeCode = 0x6;
            blockSizeExtra = 8;
        } else {
            blockSizeCode = 0x7;
            blockSizeExtra = 16;
        }
        wb((blockSizeCode << 4) | 0x00); // block size code | sample rate code (0=from STREAMINFO)
        wb(((numChannels - 1) << 4) | (0x4 << 1) | 0); // channel assignment | sample size (0=from STREAMINFO) | reserved
        for (const b of encodeUtf8Number(frameNumber)) {
            wb(b);
        } // frame number (UTF-8 encoded)
        if (blockSizeExtra === 8) {
            wb(blockSize - 1);
        } else if (blockSizeExtra === 16) {
            wbe16(blockSize - 1);
        }
        wb(crc8(out, frameStart, pos)); // CRC-8 of header

        // Subframes — written bit-by-bit
        const bw = new BitWriter(out, pos);
        for (let ch = 0; ch < numChannels; ch++) {
            encodeSubframe(bw, int16Channels[ch]!, sampleOffset, blockSize);
        }
        bw.flush(); // pad to byte boundary
        pos = bw.pos;

        // Frame CRC-16
        wbe16(crc16(out, frameStart, pos));

        sampleOffset += blockSize;
        frameNumber++;

        if (frameNumber % 16 === 0) {
            onProgress?.(sampleOffset / totalSamples);
            await new Promise<void>((r) => setTimeout(r, 0));
        }
    }

    onProgress?.(1);
    return out.subarray(0, pos);
}

export async function audioBufferToFlac(buffer: AudioBuffer, onProgress?: (frac: number) => void): Promise<Uint8Array> {
    return await encodeFlac(buffer, onProgress);
}
