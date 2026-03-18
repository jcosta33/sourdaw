async function triggerBlobDownload(blob: Blob, filename: string): Promise<void> {
    // Try File System Access API for a proper native Save dialog
    if ('showSaveFilePicker' in window) {
        try {
            const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
            const mimeMap: Record<string, string> = {
                '.wav': 'audio/wav',
                '.mp3': 'audio/mpeg',
                '.flac': 'audio/flac',
                '.webdaw': 'application/json',
                '.json': 'application/json',
            };
            const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
                suggestedName: filename,
                types: ext ? [{
                    description: ext.slice(1).toUpperCase() + ' file',
                    accept: { [mimeMap[ext] ?? 'application/octet-stream']: [ext] },
                }] : undefined,
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch {
            // User cancelled or API error — don't fall through to anchor
            return;
        }
    }

    // Fallback: anchor download (Chrome, Firefox, etc.)
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 1000);
}

export function audioBufferToWav(buffer: AudioBuffer, bitDepth: 16 | 24 | 32 = 16): ArrayBuffer {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const isFloat = bitDepth === 32;
    const bitsPerSample = bitDepth;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;
    const fmtSize = isFloat ? 18 : 16;
    const headerLength = 20 + fmtSize + 8;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    function writeString(offset: number, str: string) {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    writeString(0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, fmtSize, true);
    view.setUint16(20, isFloat ? 3 : 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    if (isFloat) {
        view.setUint16(36, 0, true);
    }

    const dataOffset = 12 + 8 + fmtSize;
    writeString(dataOffset, 'data');
    view.setUint32(dataOffset + 4, dataLength, true);

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(buffer.getChannelData(ch));
    }

    const tpdfDither = (): number => Math.random() - Math.random();

    let offset = dataOffset + 8;
    for (let i = 0; i < buffer.length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch]![i]!));
            if (bitDepth === 16) {
                const dithered = sample + tpdfDither() / 0x8000;
                const clamped = Math.max(-1, Math.min(1, dithered));
                view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
            } else if (bitDepth === 24) {
                const val = sample < 0 ? sample * 0x800000 : sample * 0x7fffff;
                const int = Math.round(val);
                view.setUint8(offset, int & 0xff);
                view.setUint8(offset + 1, (int >> 8) & 0xff);
                view.setUint8(offset + 2, (int >> 16) & 0xff);
            } else {
                view.setFloat32(offset, sample, true);
            }
            offset += bytesPerSample;
        }
    }

    return arrayBuffer;
}

export async function downloadWav(buffer: AudioBuffer, filename = 'export.wav', bitDepth: 16 | 24 | 32 = 16): Promise<void> {
    const wav = audioBufferToWav(buffer, bitDepth);
    const blob = new Blob([wav], { type: 'audio/wav' });
    await triggerBlobDownload(blob, filename);
}

type LameEncoder = {
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
    flush(): Int8Array;
};

type LameModule = {
    Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => LameEncoder;
};

function encodePcmToMp3(buffer: AudioBuffer, encoder: LameEncoder): Uint8Array {
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const left = new Int16Array(buffer.length);
    const right = numChannels === 2 ? new Int16Array(buffer.length) : left;

    const leftFloat = buffer.getChannelData(0);
    const rightFloat = numChannels === 2 ? buffer.getChannelData(1) : leftFloat;

    for (let i = 0; i < buffer.length; i++) {
        left[i] = Math.max(-32768, Math.min(32767, Math.round(leftFloat[i]! * 32767)));
        right[i] = Math.max(-32768, Math.min(32767, Math.round(rightFloat[i]! * 32767)));
    }

    const chunks: Int8Array[] = [];
    const BLOCK = 1152;

    for (let i = 0; i < buffer.length; i += BLOCK) {
        const leftChunk = left.subarray(i, i + BLOCK);
        const rightChunk = numChannels === 2 ? right.subarray(i, i + BLOCK) : undefined;
        const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
        if (mp3buf.length > 0) {
            chunks.push(mp3buf);
        }
    }

    const tail = encoder.flush();
    if (tail.length > 0) {
        chunks.push(tail);
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), offset);
        offset += chunk.length;
    }

    return result;
}

export async function downloadMp3(buffer: AudioBuffer, filename = 'export.mp3', bitRate = 128): Promise<void> {
    const lamejs = (await import('lamejs')) as unknown as LameModule;
    const numChannels = Math.min(buffer.numberOfChannels, 2);
    const encoder = new lamejs.Mp3Encoder(numChannels, buffer.sampleRate, bitRate);
    const mp3Data = encodePcmToMp3(buffer, encoder);
    const blob = new Blob([mp3Data.buffer as ArrayBuffer], { type: 'audio/mpeg' });
    await triggerBlobDownload(blob, filename);
}

// ---------------------------------------------------------------------------
// FLAC encoder — verbatim (uncompressed) subframes, 16-bit signed PCM
// Produces valid FLAC files that any decoder can read.
// ---------------------------------------------------------------------------

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

function encodeFlac(buffer: AudioBuffer): Uint8Array {
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

    // "fLaC" stream marker
    out[pos++] = 0x66; // f
    out[pos++] = 0x4c; // L
    out[pos++] = 0x61; // a
    out[pos++] = 0x43; // C

    // STREAMINFO metadata block (last block = 0x80 flag, type 0, length 34)
    writeByte(0x80);
    writeBe24(34);

    // min/max block size
    writeBe16(FLAC_BLOCK_SIZE);
    writeBe16(FLAC_BLOCK_SIZE);

    // min/max frame size (0 = unknown)
    writeBe24(0);
    writeBe24(0);

    // sample rate (20 bits) | channels-1 (3 bits) | bps-1 (5 bits) | total samples high 4 bits
    const srHigh = (sampleRate >> 12) & 0xff;
    const srMid = (sampleRate >> 4) & 0xff;
    const srLowAndChannels = ((sampleRate & 0xf) << 4) | ((numChannels - 1) << 1) | ((bitsPerSample - 1) >> 4);
    const bpsLowAndSamplesHigh = (((bitsPerSample - 1) & 0xf) << 4) | ((totalSamples >> 32) & 0xf);

    writeByte(srHigh);
    writeByte(srMid);
    writeByte(srLowAndChannels);
    writeByte(bpsLowAndSamplesHigh);

    // total samples low 32 bits
    out[pos++] = (totalSamples >>> 24) & 0xff;
    out[pos++] = (totalSamples >>> 16) & 0xff;
    out[pos++] = (totalSamples >>> 8) & 0xff;
    out[pos++] = totalSamples & 0xff;

    // MD5 signature (16 bytes of zeros — not computed for verbatim encoding)
    for (let i = 0; i < 16; i++) {
        writeByte(0);
    }

    // Audio frames
    let sampleOffset = 0;
    let frameNumber = 0;

    while (sampleOffset < totalSamples) {
        const blockSize = Math.min(FLAC_BLOCK_SIZE, totalSamples - sampleOffset);
        const frameStart = pos;

        // Frame header sync code: 0xFFF8 (fixed block size, 16-bit)
        writeBe16(0xfff8);

        // Block size code and sample rate code
        // blockSize=4096 → code 0xC (4096), unless last frame is smaller
        let blockSizeCode: number;
        let blockSizeExtraBits = 0;
        if (blockSize === 4096) {
            blockSizeCode = 0xc;
        } else if (blockSize <= 255) {
            blockSizeCode = 0x6; // 8-bit end-of-stream block size follows
            blockSizeExtraBits = 8;
        } else {
            blockSizeCode = 0x7; // 16-bit end-of-stream block size follows
            blockSizeExtraBits = 16;
        }

        // Sample rate code: 0 = get from STREAMINFO
        writeByte((blockSizeCode << 4) | 0x00);

        // Channel assignment (independent) | sample size (16-bit = 0x4) | reserved bit 0
        writeByte(((numChannels - 1) << 4) | (0x4 << 1) | 0);

        // Frame number in UTF-8 coding
        const utf8Bytes = encodeUtf8Number(frameNumber);
        for (const b of utf8Bytes) {
            writeByte(b);
        }

        // Extra block size bytes
        if (blockSizeExtraBits === 8) {
            writeByte(blockSize - 1);
        } else if (blockSizeExtraBits === 16) {
            writeBe16(blockSize - 1);
        }

        // CRC-8 of frame header
        const headerCrc = crc8(out, frameStart, pos);
        writeByte(headerCrc);

        // Subframes — one per channel, verbatim type
        for (let ch = 0; ch < numChannels; ch++) {
            // Subframe header: 0 padding (1 bit) | type verbatim=01 (6 bits) | no wasted bits (1 bit)
            // verbatim subframe type = 0b000001 → header byte = 0b0_000001_0 = 0x02
            writeByte(0x02);

            const channelData = channels[ch]!;
            for (let i = 0; i < blockSize; i++) {
                const sample = Math.max(-1, Math.min(1, channelData[sampleOffset + i]!));
                const int16 = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
                writeBe16(int16 & 0xffff);
            }
        }

        // Byte-align (already aligned since 16-bit samples)

        // CRC-16 of entire frame
        const frameCrc = crc16(out, frameStart, pos);
        writeBe16(frameCrc);

        sampleOffset += blockSize;
        frameNumber++;
    }

    return out.subarray(0, pos);
}

export async function downloadFlac(buffer: AudioBuffer, filename = 'export.flac'): Promise<void> {
    const flacData = encodeFlac(buffer);
    const blob = new Blob([flacData.buffer as ArrayBuffer], { type: 'audio/flac' });
    await triggerBlobDownload(blob, filename);
}
