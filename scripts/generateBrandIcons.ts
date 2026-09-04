import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildIcns,
    buildIco,
    decodePng,
    type DecodedPng,
    downscaleAreaAverage,
    encodeLegacyArgb,
    encodePng,
    scaleBilinear,
} from './brandIconFormats.ts';

export { decodePng, type DecodedPng, downscaleAreaAverage, encodePng };

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

function compositeTransparentAndMark(
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
        for (let x = 0; x < destW; x += 1) {
            const outOff = (y * destW + x) * 4;
            const s = shadowMap[y * destW + x]!;

            const srcX = x - markOffsetX;
            const srcY = y - markOffsetY;
            let markR = 0;
            let markG = 0;
            let markB = 0;
            let markA = 0;

            if (srcX >= 0 && srcX < markW && srcY >= 0 && srcY < markH) {
                const idx = (srcY * markW + srcX) * 4;
                markA = markPixels[idx + 3]!;
                if (markA > 0) {
                    markR = markPixels[idx]!;
                    markG = markPixels[idx + 1]!;
                    markB = markPixels[idx + 2]!;
                }
            }

            if (markA === 255) {
                pixels[outOff] = markR;
                pixels[outOff + 1] = markG;
                pixels[outOff + 2] = markB;
                pixels[outOff + 3] = 255;
            } else if (markA > 0) {
                const alphaMark = markA / 255;
                const alphaShadow = s;
                const outAlphaNorm = alphaMark + alphaShadow * (1 - alphaMark);
                const r = Math.round((markR * alphaMark) / outAlphaNorm);
                const g = Math.round((markG * alphaMark) / outAlphaNorm);
                const b = Math.round((markB * alphaMark) / outAlphaNorm);
                pixels[outOff] = r;
                pixels[outOff + 1] = g;
                pixels[outOff + 2] = b;
                pixels[outOff + 3] = Math.round(outAlphaNorm * 255);
            } else if (s > 0) {
                pixels[outOff] = 0;
                pixels[outOff + 1] = 0;
                pixels[outOff + 2] = 0;
                pixels[outOff + 3] = Math.round(s * 255);
            } else {
                pixels[outOff] = 0;
                pixels[outOff + 1] = 0;
                pixels[outOff + 2] = 0;
                pixels[outOff + 3] = 0;
            }
        }
    }
    return pixels;
}

export function renderTransparent480(authority: DecodedPng): Buffer {
    const shadowMap = computeShadowMap(authority.pixels, authority.width, authority.height, 480, 480, 66, 30, 6, 0.75);
    return compositeTransparentAndMark(
        480,
        480,
        authority.pixels,
        authority.width,
        authority.height,
        66,
        24,
        shadowMap
    );
}

export function renderMaster1024(authority: DecodedPng): Buffer {
    const scale = 1024 / 480;
    const targetMarkW = Math.round(346 * scale);
    const targetMarkH = Math.round(427 * scale);
    const targetMarkX = Math.round(66 * scale);
    const targetMarkY = Math.round(24 * scale);
    const shadowOffsetY = Math.round(6 * scale);
    const shadowBlur = Math.round(6 * scale);

    const scaledMarkPixels = scaleBilinear(
        authority.pixels,
        authority.width,
        authority.height,
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

export function renderMaster1024Transparent(authority: DecodedPng): Buffer {
    const scale = 1024 / 480;
    const targetMarkW = Math.round(346 * scale);
    const targetMarkH = Math.round(427 * scale);
    const targetMarkX = Math.round(66 * scale);
    const targetMarkY = Math.round(24 * scale);
    const shadowOffsetY = Math.round(6 * scale);
    const shadowBlur = Math.round(6 * scale);

    const scaledMarkPixels = scaleBilinear(
        authority.pixels,
        authority.width,
        authority.height,
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

    return compositeTransparentAndMark(
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
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const authorityBuf = readFileSync(resolve(root, 'scripts/assets/canonical-mark.png'));
    const authority = decodePng(authorityBuf);

    // Render 480x480 canonical pixel buffer (opaque)
    const canonical480Pixels = renderCanonical480(authority);
    const canonical480Png = encodePng(480, 480, canonical480Pixels);

    // Save public/icon.png and sourdaw.png
    writeFileSync(resolve(root, 'public/icon.png'), canonical480Png);
    writeFileSync(resolve(root, 'sourdaw.png'), canonical480Png);

    // Render 480x480 transparent pixel buffer with tactile shadow
    const transparent480Pixels = renderTransparent480(authority);
    const transparent480Png = encodePng(480, 480, transparent480Pixels);
    writeFileSync(resolve(root, 'public/icon-transparent.png'), transparent480Png);

    // Render master 1024 directly from the transparent authority mark (opaque)
    const master1024Pixels = renderMaster1024(authority);

    // Render master 1024 transparent with tactile shadow
    const master1024TransparentPixels = renderMaster1024Transparent(authority);

    // Size pixel cache for high-precision area-averaging (opaque)
    const pixelCache = new Map<number, Buffer>();
    pixelCache.set(1024, master1024Pixels);
    pixelCache.set(480, canonical480Pixels);

    // Size pixel cache for high-precision area-averaging (transparent)
    const transparentPixelCache = new Map<number, Buffer>();
    transparentPixelCache.set(1024, master1024TransparentPixels);
    transparentPixelCache.set(480, transparent480Pixels);

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

    function getTransparentPixels(size: number): Buffer {
        const cached = transparentPixelCache.get(size);
        if (cached !== undefined) {
            return cached;
        }
        const sourceSize = size > 256 ? 1024 : 480;
        const sourcePixels = transparentPixelCache.get(sourceSize)!;
        const res = downscaleAreaAverage(sourcePixels, sourceSize, sourceSize, size, size);
        transparentPixelCache.set(size, res);
        return res;
    }

    function getTransparentPng(size: number): Buffer {
        return encodePng(size, size, getTransparentPixels(size));
    }

    writeWebIcons(root, getPng);
    writeMacIcons(root, getPixels, getPng);
    writeWindowsIcons(root, getPng);
    writeLinuxIcons(root, getPng);
    writeIosIcons(root, getPng);
    writeAndroidIcons(root, getTransparentPng);

    console.log('All platform icon assets generated successfully!');
    logVerificationHashes(getPixels);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    main();
}
