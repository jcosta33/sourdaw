import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { deflateSync, inflateSync } from 'zlib';

type DecodedPng = {
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
            r += srcPixels[srcOff]! * weight;
            g += srcPixels[srcOff + 1]! * weight;
            b += srcPixels[srcOff + 2]! * weight;
            a += srcPixels[srcOff + 3]! * weight;
        }
    }

    if (totalWeight <= 0) {
        return [0, 0, 0, 0];
    }
    return [
        Math.round(r / totalWeight),
        Math.round(g / totalWeight),
        Math.round(b / totalWeight),
        Math.round(a / totalWeight),
    ];
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

function getBg(y: number, height: number): readonly [number, number, number] {
    const t = y / (height - 1);
    const r = Math.round(38 * (1 - t) + 8 * t);
    const g = Math.round(34 * (1 - t) + 7 * t);
    const b = Math.round(30 * (1 - t) + 6 * t);
    return [r, g, b];
}

function applyShadowPoint(
    shadowMap: Float32Array,
    targetX: number,
    targetY: number,
    alpha: number,
    radius: number,
    shadowAlpha: number,
    width: number,
    height: number
): void {
    for (let dy = -radius; dy <= radius; dy += 1) {
        const py = targetY + dy;
        if (py < 0 || py >= height) {
            continue;
        }
        for (let dx = -radius; dx <= radius; dx += 1) {
            const px = targetX + dx;
            if (px < 0 || px >= width) {
                continue;
            }
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > radius) {
                continue;
            }
            const factor = 1 - dist / radius;
            const val = (alpha / 255) * shadowAlpha * factor;
            const idx = py * width + px;
            if (val > shadowMap[idx]!) {
                shadowMap[idx] = val;
            }
        }
    }
}

function computeShadowMap(
    markPixels: Buffer,
    markW: number,
    markH: number,
    destW: number,
    destH: number,
    offsetX: number,
    offsetY: number,
    radius: number,
    shadowAlpha: number
): Float32Array {
    const shadowMap = new Float32Array(destW * destH);
    for (let sy = 0; sy < markH; sy += 1) {
        for (let sx = 0; sx < markW; sx += 1) {
            const a = markPixels[(sy * markW + sx) * 4 + 3]!;
            if (a === 0) {
                continue;
            }
            applyShadowPoint(shadowMap, sx + offsetX, sy + offsetY, a, radius, shadowAlpha, destW, destH);
        }
    }
    return shadowMap;
}

function compositeBackgroundAndMark(
    destW: number,
    destH: number,
    markPixels: Buffer,
    markW: number,
    markH: number,
    markOffsetX: number,
    markOffsetY: number,
    shadowMap: Float32Array
): Buffer {
    const pixels = Buffer.alloc(destW * destH * 4);
    for (let y = 0; y < destH; y += 1) {
        const [bgR, bgG, bgB] = getBg(y, destH);
        for (let x = 0; x < destW; x += 1) {
            const outOff = (y * destW + x) * 4;
            let r = bgR;
            let g = bgG;
            let b = bgB;

            const s = shadowMap[y * destW + x]!;
            if (s > 0) {
                const darkFactor = 1 - s;
                r = Math.round(r * darkFactor);
                g = Math.round(g * darkFactor);
                b = Math.round(b * darkFactor);
            }

            const srcX = x - markOffsetX;
            const srcY = y - markOffsetY;
            if (srcX >= 0 && srcX < markW && srcY >= 0 && srcY < markH) {
                const idx = (srcY * markW + srcX) * 4;
                const fa = markPixels[idx + 3]!;
                if (fa === 255) {
                    pixels[outOff] = markPixels[idx]!;
                    pixels[outOff + 1] = markPixels[idx + 1]!;
                    pixels[outOff + 2] = markPixels[idx + 2]!;
                    pixels[outOff + 3] = 255;
                    continue;
                }
                if (fa > 0) {
                    const alpha = fa / 255;
                    const inv = 1 - alpha;
                    pixels[outOff] = Math.round(markPixels[idx]! * alpha + r * inv);
                    pixels[outOff + 1] = Math.round(markPixels[idx + 1]! * alpha + g * inv);
                    pixels[outOff + 2] = Math.round(markPixels[idx + 2]! * alpha + b * inv);
                    pixels[outOff + 3] = 255;
                    continue;
                }
            }

            pixels[outOff] = r;
            pixels[outOff + 1] = g;
            pixels[outOff + 2] = b;
            pixels[outOff + 3] = 255;
        }
    }
    return pixels;
}

export function renderCanonical480(authority: DecodedPng): Buffer {
    const shadowMap = computeShadowMap(authority.pixels, authority.width, authority.height, 480, 480, 66, 30, 6, 0.75);
    return compositeBackgroundAndMark(480, 480, authority.pixels, authority.width, authority.height, 66, 24, shadowMap);
}

export function renderMaster1024(highResMark: DecodedPng): Buffer {
    const scale = 1024 / 480;
    const targetMarkW = Math.round(346 * scale);
    const targetMarkH = Math.round(427 * scale);
    const targetMarkX = Math.round(66 * scale);
    const targetMarkY = Math.round(24 * scale);
    const shadowOffsetY = Math.round(6 * scale);
    const shadowBlur = Math.round(6 * scale);

    const scaledMarkPixels = downscaleAreaAverage(
        highResMark.pixels,
        highResMark.width,
        highResMark.height,
        targetMarkW,
        targetMarkH
    );

    const shadowMap = computeShadowMap(
        scaledMarkPixels,
        targetMarkW,
        targetMarkH,
        1024,
        1024,
        targetMarkX,
        targetMarkY + shadowOffsetY,
        shadowBlur,
        0.75
    );

    return compositeBackgroundAndMark(
        1024,
        1024,
        scaledMarkPixels,
        targetMarkW,
        targetMarkH,
        targetMarkX,
        targetMarkY,
        shadowMap
    );
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

function encodeLegacyArgb(pixels: Buffer, size: number): Buffer {
    const pixelCount = size * size;
    const channels = Buffer.alloc(pixelCount * 4);
    for (let i = 0; i < pixelCount; i += 1) {
        channels[i] = pixels[i * 4 + 3]!; // A
        channels[pixelCount + i] = pixels[i * 4]!; // R
        channels[pixelCount * 2 + i] = pixels[i * 4 + 1]!; // G
        channels[pixelCount * 3 + i] = pixels[i * 4 + 2]!; // B
    }
    const packed = encodePackBits(channels);
    return Buffer.concat([Buffer.from('ARGB', 'ascii'), packed]);
}

function buildIcns(framesMap: ReadonlyMap<string, Buffer>): Buffer {
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

function buildIco(framesArray: ReadonlyArray<{ readonly png: Buffer; readonly size: number }>): Buffer {
    const count = framesArray.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // ICO
    header.writeUInt16LE(count, 4);

    let currentOffset = 6 + count * 16;
    const dirEntries: Buffer[] = [];
    const payloads: Buffer[] = [];
    for (const frame of framesArray) {
        const entry = Buffer.alloc(16);
        entry[0] = frame.size >= 256 ? 0 : frame.size;
        entry[1] = frame.size >= 256 ? 0 : frame.size;
        entry[2] = 0; // color count
        entry[3] = 0; // reserved
        entry.writeUInt16LE(1, 4); // color planes
        entry.writeUInt16LE(32, 6); // bit depth
        entry.writeUInt32LE(frame.png.length, 8);
        entry.writeUInt32LE(currentOffset, 12);
        dirEntries.push(entry);
        payloads.push(frame.png);
        currentOffset += frame.png.length;
    }
    return Buffer.concat([header, ...dirEntries, ...payloads]);
}

function writeWebIcons(root: string, getPng: (sz: number) => Buffer): void {
    writeFileSync(resolve(root, 'public/icon-192.png'), getPng(192));
    const faviconSizes = [16, 24, 32, 48, 64] as const;
    const faviconIco = buildIco(faviconSizes.map((sz) => ({ png: getPng(sz), size: sz })));
    writeFileSync(resolve(root, 'public/favicon.ico'), faviconIco);
}

function writeMacIcons(root: string, getPixels: (sz: number) => Buffer, getPng: (sz: number) => Buffer): void {
    const icnsFrames = new Map<string, Buffer>();
    icnsFrames.set('ic04', encodeLegacyArgb(getPixels(16), 16));
    icnsFrames.set('ic05', encodeLegacyArgb(getPixels(32), 32));
    icnsFrames.set('ic07', getPng(128));
    icnsFrames.set('ic08', getPng(256));
    icnsFrames.set('ic09', getPng(512));
    icnsFrames.set('ic10', getPng(1024));
    icnsFrames.set('ic11', getPng(32));
    icnsFrames.set('ic12', getPng(64));
    icnsFrames.set('ic13', getPng(256));
    icnsFrames.set('ic14', getPng(512));
    writeFileSync(resolve(root, 'build/icons/icon.icns'), buildIcns(icnsFrames));
}

function writeWindowsIcons(root: string, getPng: (sz: number) => Buffer): void {
    const icoSizes = [16, 24, 32, 48, 64, 256] as const;
    const windowsIco = buildIco(icoSizes.map((sz) => ({ png: getPng(sz), size: sz })));
    writeFileSync(resolve(root, 'build/icons/icon.ico'), windowsIco);

    const squareTiles = [30, 44, 71, 89, 107, 142, 150, 284, 310] as const;
    for (const sz of squareTiles) {
        writeFileSync(resolve(root, `build/icons/Square${sz}x${sz}Logo.png`), getPng(sz));
    }
    writeFileSync(resolve(root, 'build/icons/StoreLogo.png'), getPng(50));
}

function writeLinuxIcons(root: string, getPng: (sz: number) => Buffer): void {
    const linuxSizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024] as const;
    for (const sz of linuxSizes) {
        writeFileSync(resolve(root, `build/icons/${sz}x${sz}.png`), getPng(sz));
    }
    writeFileSync(resolve(root, 'build/icons/128x128@2x.png'), getPng(256));
    writeFileSync(resolve(root, 'build/icons/icon.png'), getPng(512));
}

function writeIosIcons(root: string, getPng: (sz: number) => Buffer): void {
    const iosEntries: Array<[string, number]> = [
        ['AppIcon-20x20@1x.png', 20],
        ['AppIcon-20x20@2x.png', 40],
        ['AppIcon-20x20@2x-1.png', 40],
        ['AppIcon-20x20@3x.png', 60],
        ['AppIcon-29x29@1x.png', 29],
        ['AppIcon-29x29@2x.png', 58],
        ['AppIcon-29x29@2x-1.png', 58],
        ['AppIcon-29x29@3x.png', 87],
        ['AppIcon-40x40@1x.png', 40],
        ['AppIcon-40x40@2x.png', 80],
        ['AppIcon-40x40@2x-1.png', 80],
        ['AppIcon-40x40@3x.png', 120],
        ['AppIcon-60x60@2x.png', 120],
        ['AppIcon-60x60@3x.png', 180],
        ['AppIcon-76x76@1x.png', 76],
        ['AppIcon-76x76@2x.png', 152],
        ['AppIcon-83.5x83.5@2x.png', 167],
        ['AppIcon-512@2x.png', 1024],
    ];
    for (const [filename, sz] of iosEntries) {
        writeFileSync(resolve(root, `build/icons/ios/${filename}`), getPng(sz));
    }
}

function writeAndroidIcons(root: string, getPng: (sz: number) => Buffer): void {
    const androidEntries: Array<[string, number]> = [
        ['mipmap-mdpi/ic_launcher_foreground.png', 108],
        ['mipmap-hdpi/ic_launcher_foreground.png', 162],
        ['mipmap-xhdpi/ic_launcher_foreground.png', 216],
        ['mipmap-xxhdpi/ic_launcher_foreground.png', 324],
        ['mipmap-xxxhdpi/ic_launcher_foreground.png', 432],
    ];
    for (const [relPath, sz] of androidEntries) {
        writeFileSync(resolve(root, `build/icons/android/${relPath}`), getPng(sz));
    }
}

function icnsFrameSize(tag: string): number {
    switch (tag) {
        case 'ic04':
            return 16;
        case 'ic05':
        case 'ic11':
            return 32;
        case 'ic12':
            return 64;
        case 'ic07':
            return 128;
        case 'ic08':
        case 'ic13':
            return 256;
        case 'ic09':
        case 'ic14':
            return 512;
        default:
            return 1024;
    }
}

function logVerificationHashes(getPixels: (sz: number) => Buffer): void {
    console.log('\n--- ICNS PIXEL SHA256 ---');
    for (const tag of ['ic04', 'ic05', 'ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14']) {
        const sz = icnsFrameSize(tag);
        const px = getPixels(sz);
        const hash = createHash('sha256').update(px).digest('hex');
        console.log(`    ${tag}: '${hash}',`);
    }

    console.log('\n--- ICO PIXEL SHA256 ---');
    for (const sz of [16, 24, 32, 48, 64, 256]) {
        const px = getPixels(sz);
        const hash = createHash('sha256').update(px).digest('hex');
        console.log(`    ${sz}: '${hash}',`);
    }
}

export function main(): void {
    const root = process.cwd();
    const authorityBuf = readFileSync(resolve(root, 'public/icon-transparent.png'));
    const authority = decodePng(authorityBuf);

    // Render 480x480 canonical pixel buffer
    const canonical480Pixels = renderCanonical480(authority);
    const canonical480Png = encodePng(480, 480, canonical480Pixels);

    // Save public/icon.png and sourdaw.png
    writeFileSync(resolve(root, 'public/icon.png'), canonical480Png);
    writeFileSync(resolve(root, 'sourdaw.png'), canonical480Png);

    // Decode existing 1024 transparent mark to render master 1024
    const highResMark = decodePng(readFileSync(resolve(root, 'build/icons/1024x1024.png')));
    const master1024Pixels = renderMaster1024(highResMark);

    // Size pixel cache for high-precision area-averaging
    const pixelCache = new Map<number, Buffer>();
    pixelCache.set(1024, master1024Pixels);
    pixelCache.set(480, canonical480Pixels);

    function getPixels(size: number): Buffer {
        const cached = pixelCache.get(size);
        if (cached !== undefined) {
            return cached;
        }
        const sourceSize = size > 256 ? 1024 : 480;
        const sourcePixels = pixelCache.get(sourceSize)!;
        const res = downscaleAreaAverage(sourcePixels, sourceSize, sourceSize, size, size);
        pixelCache.set(size, res);
        return res;
    }

    function getPng(size: number): Buffer {
        return encodePng(size, size, getPixels(size));
    }

    writeWebIcons(root, getPng);
    writeMacIcons(root, getPixels, getPng);
    writeWindowsIcons(root, getPng);
    writeLinuxIcons(root, getPng);
    writeIosIcons(root, getPng);
    writeAndroidIcons(root, getPng);

    console.log('All platform icon assets generated successfully!');
    logVerificationHashes(getPixels);
}

main();
