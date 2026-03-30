/**
 * FLAC encoder — verbatim (uncompressed) subframes, 16-bit signed PCM.
 * Produces valid FLAC files that any decoder can read.
 *
 * TODO: Verbatim encoding only (no compression). Should use prediction for smaller files.
 * TODO: MD5 signature is zeroed — not computed.
 */

const CRC8_POLY = 0x07;
const CRC16_POLY = 0x8005;

function buildCrc8Table(): Uint8Array {
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        let crc = i;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ CRC8_POLY) & 0xff : (crc << 1) & 0xff;
        }
        table[i] = crc;
    }
    return table;
}

function buildCrc16Table(): Uint16Array {
    const table = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
        let crc = i << 8;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ CRC16_POLY) & 0xffff : (crc << 1) & 0xffff;
        }
        table[i] = crc;
    }
    return table;
}

const CRC8_TABLE = buildCrc8Table();
const CRC16_TABLE = buildCrc16Table();

function crc8(data: Uint8Array, start: number, end: number): number {
    let crc = 0;
    for (let i = start; i < end; i++) {
        crc = CRC8_TABLE[crc ^ data[i]!]!;
    }
    return crc;
}

function crc16(data: Uint8Array, start: number, end: number): number {
    let crc = 0;
    for (let i = start; i < end; i++) {
        crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ data[i]!) & 0xff]!) & 0xffff;
    }
    return crc;
}

function encodeUtf8Number(n: number): number[] {
    if (n < 0x80) {
        return [n];
    }
    if (n < 0x800) {
        return [0xc0 | (n >> 6), 0x80 | (n & 0x3f)];
    }
    if (n < 0x10000) {
        return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)];
    }
    if (n < 0x200000) {
        return [0xf0 | (n >> 18), 0x80 | ((n >> 12) & 0x3f), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)];
    }
    if (n < 0x4000000) {
        return [
            0xf8 | (n >> 24),
            0x80 | ((n >> 18) & 0x3f),
            0x80 | ((n >> 12) & 0x3f),
            0x80 | ((n >> 6) & 0x3f),
            0x80 | (n & 0x3f),
        ];
    }
    return [
        0xfc | (n >> 30),
        0x80 | ((n >> 24) & 0x3f),
        0x80 | ((n >> 18) & 0x3f),
        0x80 | ((n >> 12) & 0x3f),
        0x80 | ((n >> 6) & 0x3f),
        0x80 | (n & 0x3f),
    ];
}

const FLAC_BLOCK_SIZE = 4096;

async function encodeFlac(buffer: AudioBuffer, onProgress?: (frac: number) => void): Promise<Uint8Array> {
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const sampleRate = buffer.sampleRate;
    const totalSamples = buffer.length;
    const bitsPerSample = 16;

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(buffer.getChannelData(ch));
    }

    const frameCount = Math.ceil(totalSamples / FLAC_BLOCK_SIZE);
    const maxFrameBytes = 16 + numChannels * FLAC_BLOCK_SIZE * 2 + 2;
    const estimatedSize = 42 + frameCount * maxFrameBytes;
    const out = new Uint8Array(estimatedSize);
    let pos = 0;

    function writeByte(b: number) {
        out[pos++] = b & 0xff;
    }
    function writeBe16(v: number) {
        out[pos++] = (v >> 8) & 0xff;
        out[pos++] = v & 0xff;
    }
    function writeBe24(v: number) {
        out[pos++] = (v >> 16) & 0xff;
        out[pos++] = (v >> 8) & 0xff;
        out[pos++] = v & 0xff;
    }

    out[pos++] = 0x66;
    out[pos++] = 0x4c;
    out[pos++] = 0x61;
    out[pos++] = 0x43;

    writeByte(0x80);
    writeBe24(34);

    writeBe16(FLAC_BLOCK_SIZE);
    writeBe16(FLAC_BLOCK_SIZE);

    writeBe24(0);
    writeBe24(0);

    const srHigh = (sampleRate >> 12) & 0xff;
    const srMid = (sampleRate >> 4) & 0xff;
    const srLowAndChannels = ((sampleRate & 0xf) << 4) | ((numChannels - 1) << 1) | ((bitsPerSample - 1) >> 4);
    const bpsLowAndSamplesHigh = (((bitsPerSample - 1) & 0xf) << 4) | ((totalSamples >> 32) & 0xf);

    writeByte(srHigh);
    writeByte(srMid);
    writeByte(srLowAndChannels);
    writeByte(bpsLowAndSamplesHigh);

    out[pos++] = (totalSamples >>> 24) & 0xff;
    out[pos++] = (totalSamples >>> 16) & 0xff;
    out[pos++] = (totalSamples >>> 8) & 0xff;
    out[pos++] = totalSamples & 0xff;

    for (let i = 0; i < 16; i++) {
        writeByte(0);
    }

    let sampleOffset = 0;
    let frameNumber = 0;

    while (sampleOffset < totalSamples) {
        const blockSize = Math.min(FLAC_BLOCK_SIZE, totalSamples - sampleOffset);
        const frameStart = pos;

        writeBe16(0xfff8);

        let blockSizeCode: number;
        let blockSizeExtraBits = 0;
        if (blockSize === 4096) {
            blockSizeCode = 0xc;
        } else if (blockSize <= 255) {
            blockSizeCode = 0x6;
            blockSizeExtraBits = 8;
        } else {
            blockSizeCode = 0x7;
            blockSizeExtraBits = 16;
        }

        writeByte((blockSizeCode << 4) | 0x00);
        writeByte(((numChannels - 1) << 4) | (0x4 << 1) | 0);

        const utf8Bytes = encodeUtf8Number(frameNumber);
        for (const b of utf8Bytes) {
            writeByte(b);
        }

        if (blockSizeExtraBits === 8) {
            writeByte(blockSize - 1);
        } else if (blockSizeExtraBits === 16) {
            writeBe16(blockSize - 1);
        }

        const headerCrc = crc8(out, frameStart, pos);
        writeByte(headerCrc);

        for (let ch = 0; ch < numChannels; ch++) {
            writeByte(0x02);
            const channelData = channels[ch]!;
            for (let i = 0; i < blockSize; i++) {
                const sample = Math.max(-1, Math.min(1, channelData[sampleOffset + i]!));
                const int16 = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
                writeBe16(int16 & 0xffff);
            }
        }

        const frameCrc = crc16(out, frameStart, pos);
        writeBe16(frameCrc);

        sampleOffset += blockSize;
        frameNumber++;

        if (frameNumber % 32 === 0) {
            onProgress?.(sampleOffset / totalSamples);
            await new Promise<void>((r) => setTimeout(r, 0));
        }
    }

    onProgress?.(1);
    return out.subarray(0, pos);
}

export async function audioBufferToFlac(
    buffer: AudioBuffer,
    onProgress?: (frac: number) => void
): Promise<Uint8Array> {
    return await encodeFlac(buffer, onProgress);
}
