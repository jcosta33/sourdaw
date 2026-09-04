import { deflateSync, inflateSync } from 'node:zlib';

export type DecodedPng = {
    readonly height: number;
    readonly pixels: Buffer;
    readonly width: number;
};

function paethPredictor(left: number, above: number, upperLeft: number): number {
    const p = left + above - upperLeft;
    const pa = Math.abs(p - left);
    const pb = Math.abs(p - above);
    const pc = Math.abs(p - upperLeft);
    if (pa <= pb && pa <= pc) {
        return left;
    }
    return pb <= pc ? above : upperLeft;
}

function pngFilterPredictor(filter: number, left: number, above: number, upperLeft: number): number {
    if (filter === 1) {
        return left;
    }
    if (filter === 2) {
        return above;
    }
    if (filter === 3) {
        return Math.floor((left + above) / 2);
    }
    if (filter === 4) {
        return paethPredictor(left, above, upperLeft);
    }
    return 0;
}

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
}

function calcCrc(buf: Buffer): number {
    let crc = -1;
    for (let i = 0; i < buf.length; i += 1) {
        crc = crcTable[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
    }
    return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, 4, 'ascii');
    data.copy(chunk, 8);
    const crc = calcCrc(chunk.subarray(4, 8 + data.length));
    chunk.writeUInt32BE(crc, 8 + data.length);
    return chunk;
}

export function decodePng(buf: Buffer): DecodedPng {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    let offset = 8;
    const imageData: Buffer[] = [];
    while (offset < buf.length) {
        const len = buf.readUInt32BE(offset);
        const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
        if (type === 'IDAT') {
            imageData.push(buf.subarray(offset + 8, offset + 8 + len));
        }
        offset += 12 + len;
    }
    const stride = width * 4;
    const inflated = inflateSync(Buffer.concat(imageData));
    const pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y += 1) {
        const inputRow = y * (stride + 1);
        const outputRow = y * stride;
        const filter = inflated[inputRow]!;
        for (let x = 0; x < stride; x += 1) {
            const value = inflated[inputRow + 1 + x]!;
            const left = x >= 4 ? pixels[outputRow + x - 4]! : 0;
            const above = y > 0 ? pixels[outputRow - stride + x]! : 0;
            const upperLeft = y > 0 && x >= 4 ? pixels[outputRow - stride + x - 4]! : 0;
            pixels[outputRow + x] = (value + pngFilterPredictor(filter, left, above, upperLeft)) & 0xff;
        }
    }
    return { height, pixels, width };
}

export function encodePng(width: number, height: number, pixels: Buffer): Buffer {
    const stride = width * 4;
    const rows = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const inRow = y * (stride + 1);
        rows[inRow] = 0;
        pixels.copy(rows, inRow + 1, y * stride, (y + 1) * stride);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const compressed = deflateSync(rows, { level: 9 });
    const idatChunks: Buffer[] = [];
    const maxChunk = 65536;
    let offset = 0;
    while (offset < compressed.length) {
        const len = Math.min(maxChunk, compressed.length - offset);
        idatChunks.push(pngChunk('IDAT', compressed.subarray(offset, offset + len)));
        offset += len;
    }
    return Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        pngChunk('IHDR', header),
        ...idatChunks,
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

function encodePackBits(data: Buffer): Buffer {
    const chunks: Buffer[] = [];
    let offset = 0;
    while (offset < data.length) {
        const len = Math.min(128, data.length - offset);
        chunks.push(Buffer.from([len - 1]));
        chunks.push(data.subarray(offset, offset + len));
        offset += len;
    }
    return Buffer.concat(chunks);
}

export function encodeLegacyArgb(pixels: Buffer, size: number): Buffer {
    const pixelCount = size * size;
    const channels = Buffer.alloc(pixelCount * 4);
    for (let i = 0; i < pixelCount; i += 1) {
        channels[i] = pixels[i * 4 + 3]!;
        channels[pixelCount + i] = pixels[i * 4]!;
        channels[pixelCount * 2 + i] = pixels[i * 4 + 1]!;
        channels[pixelCount * 3 + i] = pixels[i * 4 + 2]!;
    }
    const packed = encodePackBits(channels);
    return Buffer.concat([Buffer.from('ARGB', 'ascii'), packed]);
}

export function buildIcns(framesMap: ReadonlyMap<string, Buffer>): Buffer {
    const chunks: Buffer[] = [];
    let totalLen = 8;
    for (const [tag, payload] of framesMap.entries()) {
        const chunkLen = 8 + payload.length;
        totalLen += chunkLen;
        const header = Buffer.alloc(8);
        header.write(tag, 0, 4, 'ascii');
        header.writeUInt32BE(chunkLen, 4);
        chunks.push(header, payload);
    }
    const containerHeader = Buffer.alloc(8);
    containerHeader.write('icns', 0, 4, 'ascii');
    containerHeader.writeUInt32BE(totalLen, 4);
    return Buffer.concat([containerHeader, ...chunks]);
}

export function buildIco(framesArray: ReadonlyArray<{ readonly png: Buffer; readonly size: number }>): Buffer {
    const count = framesArray.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(count, 4);

    let currentOffset = 6 + count * 16;
    const dirEntries: Buffer[] = [];
    const payloads: Buffer[] = [];
    for (const frame of framesArray) {
        const entry = Buffer.alloc(16);
        entry[0] = frame.size >= 256 ? 0 : frame.size;
        entry[1] = frame.size >= 256 ? 0 : frame.size;
        entry[2] = 0;
        entry[3] = 0;
        entry.writeUInt16LE(1, 4);
        entry.writeUInt16LE(32, 6);
        entry.writeUInt32LE(frame.png.length, 8);
        entry.writeUInt32LE(currentOffset, 12);
        dirEntries.push(entry);
        payloads.push(frame.png);
        currentOffset += frame.png.length;
    }
    return Buffer.concat([header, ...dirEntries, ...payloads]);
}

function sampleAreaPixel(
    srcPixels: Buffer,
    srcW: number,
    srcH: number,
    dx: number,
    dy: number,
    xRatio: number,
    yRatio: number
): readonly [number, number, number, number] {
    const sxStart = dx * xRatio;
    const sxEnd = (dx + 1) * xRatio;
    const syStart = dy * yRatio;
    const syEnd = (dy + 1) * yRatio;

    const sxMin = Math.floor(sxStart);
    const sxMax = Math.min(srcW - 1, Math.floor(sxEnd));
    const syMin = Math.floor(syStart);
    const syMax = Math.min(srcH - 1, Math.floor(syEnd));

    let totalWeight = 0;
    let totalColorWeight = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;

    for (let sy = syMin; sy <= syMax; sy += 1) {
        const yOverlap = Math.min(sy + 1, syEnd) - Math.max(sy, syStart);
        if (yOverlap <= 0) {
            continue;
        }

        for (let sx = sxMin; sx <= sxMax; sx += 1) {
            const xOverlap = Math.min(sx + 1, sxEnd) - Math.max(sx, sxStart);
            if (xOverlap <= 0) {
                continue;
            }

            const weight = xOverlap * yOverlap;
            totalWeight += weight;

            const srcOff = (sy * srcW + sx) * 4;
            const srcA = srcPixels[srcOff + 3]!;
            const colorWeight = weight * (srcA / 255);
            totalColorWeight += colorWeight;
            r += srcPixels[srcOff]! * colorWeight;
            g += srcPixels[srcOff + 1]! * colorWeight;
            b += srcPixels[srcOff + 2]! * colorWeight;
            a += srcA * weight;
        }
    }

    if (totalWeight <= 0) {
        return [0, 0, 0, 0];
    }
    const outA = Math.round(a / totalWeight);
    if (totalColorWeight <= 0 || outA === 0) {
        return [0, 0, 0, 0];
    }
    return [Math.round(r / totalColorWeight), Math.round(g / totalColorWeight), Math.round(b / totalColorWeight), outA];
}

export function downscaleAreaAverage(
    srcPixels: Buffer,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number
): Buffer {
    const dst = Buffer.alloc(dstW * dstH * 4);
    const xRatio = srcW / dstW;
    const yRatio = srcH / dstH;

    for (let dy = 0; dy < dstH; dy += 1) {
        for (let dx = 0; dx < dstW; dx += 1) {
            const [r, g, b, a] = sampleAreaPixel(srcPixels, srcW, srcH, dx, dy, xRatio, yRatio);
            const dstOff = (dy * dstW + dx) * 4;
            dst[dstOff] = r;
            dst[dstOff + 1] = g;
            dst[dstOff + 2] = b;
            dst[dstOff + 3] = a;
        }
    }
    return dst;
}

export function scaleBilinear(srcPixels: Buffer, srcW: number, srcH: number, dstW: number, dstH: number): Buffer {
    const dst = Buffer.alloc(dstW * dstH * 4);
    const xRatio = (srcW - 1) / (dstW - 1);
    const yRatio = (srcH - 1) / (dstH - 1);

    for (let dy = 0; dy < dstH; dy += 1) {
        const sy = dy * yRatio;
        const yLow = Math.floor(sy);
        const yHigh = Math.min(srcH - 1, Math.ceil(sy));
        const yWeight = sy - yLow;

        for (let dx = 0; dx < dstW; dx += 1) {
            const sx = dx * xRatio;
            const xLow = Math.floor(sx);
            const xHigh = Math.min(srcW - 1, Math.ceil(sx));
            const xWeight = sx - xLow;

            const idx00 = (yLow * srcW + xLow) * 4;
            const idx10 = (yLow * srcW + xHigh) * 4;
            const idx01 = (yHigh * srcW + xLow) * 4;
            const idx11 = (yHigh * srcW + xHigh) * 4;

            const dstOff = (dy * dstW + dx) * 4;
            for (let c = 0; c < 4; c += 1) {
                const top = srcPixels[idx00 + c]! * (1 - xWeight) + srcPixels[idx10 + c]! * xWeight;
                const btm = srcPixels[idx01 + c]! * (1 - xWeight) + srcPixels[idx11 + c]! * xWeight;
                dst[dstOff + c] = Math.round(top * (1 - yWeight) + btm * yWeight);
            }
        }
    }
    return dst;
}
