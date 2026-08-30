import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    closeSync,
    constants,
    existsSync,
    linkSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readlinkSync,
    readSync,
    rmSync,
    symlinkSync,
    truncateSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { renderGeneratedRegion } from '../../crates/daw-dsp/benches/wasm/renderTable.mjs';
import {
    adaptedMitSourceReleaseInventoryContract,
    ADAPTED_MIT_COMMIT,
    ADAPTED_MIT_LICENSE_PATH,
    ADAPTED_MIT_LICENSE_PROOF_PATH,
    ADAPTED_MIT_NOTICE_PATH,
    ADAPTED_MIT_SOURCE_PATH,
    ADAPTED_MIT_UPSTREAM_PROOF_PATH,
    ADAPTED_ORIGINAL_COMMIT,
    ADAPTED_ORIGINAL_MIT_LICENSE_PATH,
    ADAPTED_ORIGINAL_SOURCE_PATH,
    ADAPTED_ORIGINAL_SOURCE_SHA256,
    ADAPTED_ORIGINAL_UPSTREAM_PROOF_PATH,
    assertGrandBouleDesignAroundSource,
    assertGrandBouleMeasurementAdmission,
    assertDdspModelsReleaseInventory,
    assertGrandBouleReleaseInventory,
    assertGrandBouleReleasedInWasm,
    assertOwnerVisualAssetIntegrity,
    assertProjectLicenseDistributionReleaseInventory,
    assertGrandBouleRustSourceAdmission,
    assertGrandBouleRustWasmBoundary,
    audioWorkletReleaseInventoryContract,
    checkReleaseInventory,
    DDSP_ADMISSION_DECISION_PATH,
    DDSP_MODEL_PATHS,
    DDSP_TFJS_APPLICATION_RUNTIME_PATHS,
    DDSP_TFJS_RUNTIME_PATHS,
    ddspModelsReleaseInventoryContract,
    ddspTfjsRuntimeReleaseInventoryContract,
    distributedWasmArtifactCensus,
    GRAND_BOULE_PROVIDER_POLICY_SYMLINK_PATHS,
    GRAND_BOULE_RELEASE_REGISTRY,
    grandBouleReleaseInventoryContract,
    loadRepositorySnapshot,
    OWNER_VISUAL_ASSET_PATHS,
    ownerVisualAssetReleaseInventoryContract,
    projectLicenseDistributionReleaseInventoryContract,
    readReleaseInventory,
    REQUIRED_SNAPSHOT_PATHS,
    TRADEMARK_NOTICE_PATH,
    trademarkReleaseInventoryContract,
    type RepositorySnapshotFileReader,
    type ReleaseInventory,
    type RepositorySnapshot,
    validateReleaseInventory,
    wasmReleaseInventoryContract,
} from '../checkReleaseInventory';
import { DEPENDENCY_LICENSE_REPORT_PATH } from '../dependencyLicenseReport';
import { wasmArtifacts, type WasmManifest } from '../wasm-artifacts';

const fixtureDigest = 'a'.repeat(64);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repositoryOwnerCanonical = readFileSync(join(repositoryRoot, 'public/icon.png'));
const repositoryOwnerAuthority = readFileSync(join(repositoryRoot, 'public/icon-transparent.png'));
const repositoryOwnerIcns = readFileSync(join(repositoryRoot, 'build/icons/icon.icns'));
const repositoryOwnerIco = readFileSync(join(repositoryRoot, 'build/icons/icon.ico'));
const repositoryDistributedArtifacts = distributedWasmArtifactCensus(repositoryRoot);
const repositoryDawDspArtifacts = new Set(wasmArtifacts.packages.find(({ id }) => id === 'daw-dsp')?.artifacts ?? []);
const ddspTfjsApplicationRuntimePathSet = new Set<string>(DDSP_TFJS_APPLICATION_RUNTIME_PATHS);
const ddspModelEnforcementPaths = [
    'src/modules/BrowserAi/repositories/modelDownloadManager.ts',
    'src/modules/BrowserAi/useCases/downloadDdspInstrument.ts',
    'src/modules/BrowserAi/repositories/stageDdspInstrumentGeneration.ts',
    'src/modules/BrowserAi/repositories/publishDdspInstrumentGeneration.ts',
    'src/modules/BrowserAi/repositories/checkDdspInstrumentReady.ts',
    'src/modules/BrowserAi/repositories/cleanupUnpublishedDdspGeneration.ts',
    'src/modules/BrowserAi/repositories/ddspGenerationStorageSupport.ts',
    'src/modules/BrowserAi/repositories/modelStorageWorkerBridge.ts',
    'src/modules/BrowserAi/repositories/withDdspInstrumentLock.ts',
    'src/modules/BrowserAi/workers/modelStorageWorker.ts',
    'src/modules/BrowserAi/workers/modelStorageWorkerRuntime.ts',
    'src/infra/release/modelReleaseAdmission.ts',
    'src/modules/BrowserAi/models/DdspInstrumentCatalog.ts',
    'src/modules/BrowserAi/presentations/views/ModelManagerPanel.tsx',
    'src/modules/BrowserAi/repositories/removeDdspInstrumentGenerations.ts',
    'src/modules/BrowserAi/useCases/downloadModel.ts',
    'src/modules/BrowserAi/useCases/initBrowserAi.ts',
    'src/modules/BrowserAi/useCases/removeDdspInstrument.ts',
    'src/modules/BrowserAi/useCases/removeModel.ts',
    'src/modules/BrowserAi/useCases/renderDdspInstrument.ts',
] as const;
const WEBLLM_SURFACE_ID = 'webllm-qwen-artifacts';
const WEBLLM_LEGAL_PATH_PREFIX = 'public/legal/';
// Re-pinned after #2869 amended `public/legal/THIRD-PARTY-NOTICES.md` for the
// VST3 host: the closure's paths, source buckets, and path-to-source mapping
// are byte-identical to the previous pin, and only that notice's own content
// digest moved. Any other field moving is a legal-closure change, not drift.
const WEBLLM_LEGAL_CLOSURE_DIGEST = 'b11aadca93727098096b64d2fbf0664eaff4c2268240ba5a99eca2be0c6e13a6';
const APACHE_TVM_COMMIT = 'bc1a904ec1ad89454ee6577d66cde1268b8f6bc8';
const TVM_FFI_COMMIT = '3c35034fd1026011736e19a4e0e1ed0f22058c42';

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

const ownerIconBackground: Rgba = [12, 10, 9, 255];
const ownerIcnsFrames = ['ic04', 'ic05', 'ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14'] as const;
const ownerPngIcnsFrames = ['ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14'] as const;
const ownerIcoFrames = [16, 24, 32, 48, 64, 256] as const;
const ownerPngFileByteLimit = 2 * 1024 * 1024;
const ownerPngIdatByteLimit = 1024 * 1024;

function pngCrc32(value: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of value) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function rawPngChunk(type: Buffer, data: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(pngCrc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, crc]);
}

function pngChunk(type: string, data: Buffer): Buffer {
    return rawPngChunk(Buffer.from(type, 'ascii'), data);
}

function rgbaPng(width: number, height: number, pixel: (x: number, y: number) => Rgba): Buffer {
    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const row = y * (width * 4 + 1);
        for (let x = 0; x < width; x += 1) {
            const offset = row + 1 + x * 4;
            const color = pixel(x, y);
            rows[offset] = color[0];
            rows[offset + 1] = color[1];
            rows[offset + 2] = color[2];
            rows[offset + 3] = color[3];
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(rows)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

function pngPaeth(left: number, above: number, upperLeft: number): number {
    const prediction = left + above - upperLeft;
    const leftDistance = Math.abs(prediction - left);
    const aboveDistance = Math.abs(prediction - above);
    const upperLeftDistance = Math.abs(prediction - upperLeft);
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
        return left;
    }
    return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodePngFixture(png: Buffer): { height: number; pixels: Buffer; width: number } {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const idat: Buffer[] = [];
    let offset = 8;
    while (offset < png.length) {
        const length = png.readUInt32BE(offset);
        if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
            idat.push(png.subarray(offset + 8, offset + 8 + length));
        }
        offset += 12 + length;
    }
    const filtered = inflateSync(Buffer.concat(idat));
    const stride = width * 4;
    const pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y += 1) {
        const inputRow = y * (stride + 1);
        const outputRow = y * stride;
        const filter = filtered[inputRow];
        for (let x = 0; x < stride; x += 1) {
            const value = filtered[inputRow + 1 + x];
            const left = x >= 4 ? pixels[outputRow + x - 4] : 0;
            const above = y > 0 ? pixels[outputRow - stride + x] : 0;
            const upperLeft = y > 0 && x >= 4 ? pixels[outputRow - stride + x - 4] : 0;
            let predictor = 0;
            if (filter === 1) {
                predictor = left;
            } else if (filter === 2) {
                predictor = above;
            } else if (filter === 3) {
                predictor = Math.floor((left + above) / 2);
            } else if (filter === 4) {
                predictor = pngPaeth(left, above, upperLeft);
            }
            pixels[outputRow + x] = (value + predictor) & 0xff;
        }
    }
    return { height, pixels, width };
}

function mutatePngPixel(png: Buffer, x: number, y: number, color: Rgba): Buffer {
    const decoded = decodePngFixture(png);
    const offset = (y * decoded.width + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
        decoded.pixels[offset + channel] = color[channel];
    }
    return rgbaPng(decoded.width, decoded.height, (pixelX, pixelY) => {
        const pixelOffset = (pixelY * decoded.width + pixelX) * 4;
        return [
            decoded.pixels[pixelOffset],
            decoded.pixels[pixelOffset + 1],
            decoded.pixels[pixelOffset + 2],
            decoded.pixels[pixelOffset + 3],
        ];
    });
}

function incrementPngPixelChannel(png: Buffer, x: number, y: number, channel: number): Buffer {
    const decoded = decodePngFixture(png);
    const offset = (y * decoded.width + x) * 4;
    const color: Rgba = [
        decoded.pixels[offset],
        decoded.pixels[offset + 1],
        decoded.pixels[offset + 2],
        decoded.pixels[offset + 3],
    ];
    const changed: Rgba = [
        channel === 0 ? (color[0] + 1) & 0xff : color[0],
        channel === 1 ? (color[1] + 1) & 0xff : color[1],
        channel === 2 ? (color[2] + 1) & 0xff : color[2],
        channel === 3 ? (color[3] + 1) & 0xff : color[3],
    ];
    return mutatePngPixel(png, x, y, changed);
}

function packRepeatedByte(value: number, count: number): Buffer {
    const chunks: number[] = [];
    let remaining = count;
    while (remaining > 0) {
        const length = Math.min(remaining, 130);
        if (length >= 3) {
            chunks.push(length + 0x7d, value);
        } else {
            chunks.push(length - 1, ...Array.from({ length }, () => value));
        }
        remaining -= length;
    }
    return Buffer.from(chunks);
}

function argbFixture(size: number, backgroundBlue = ownerIconBackground[2]): Buffer {
    const pixels = size * size;
    return Buffer.concat([
        Buffer.from('ARGB', 'ascii'),
        packRepeatedByte(255, pixels),
        packRepeatedByte(ownerIconBackground[0], pixels),
        packRepeatedByte(ownerIconBackground[1], pixels),
        packRepeatedByte(backgroundBlue, pixels),
        Buffer.from([0]),
    ]);
}

const ownerIcnsFrameSizes: Readonly<Record<string, number>> = {
    ic04: 16,
    ic05: 32,
    ic07: 128,
    ic08: 256,
    ic09: 512,
    ic10: 1024,
    ic11: 32,
    ic12: 64,
    ic13: 256,
    ic14: 512,
};

type IcnsFixtureChunk = { payload: Buffer; type: string };

function readIcnsFixtureChunks(container: Buffer): readonly IcnsFixtureChunk[] {
    const chunks: IcnsFixtureChunk[] = [];
    let offset = 8;
    while (offset < container.length) {
        const type = container.toString('ascii', offset, offset + 4);
        const length = container.readUInt32BE(offset + 4);
        chunks.push({ payload: container.subarray(offset + 8, offset + length), type });
        offset += length;
    }
    return chunks;
}

const repositoryIcnsChunks = readIcnsFixtureChunks(repositoryOwnerIcns);

function icnsFixturePayload(
    frame: string,
    payload: Buffer,
    options: {
        highBitArgbFrame?: string;
        malformedFrame?: string;
        seamFrame?: string;
        wrongDimensionFrame?: string;
        wrongPixelsFrame?: string;
    }
): Buffer | undefined {
    if (options.malformedFrame === frame) {
        return Buffer.from([0]);
    }
    if (options.wrongDimensionFrame === frame) {
        return rgbaPng(1, 1, () => ownerIconBackground);
    }
    if (options.seamFrame === frame) {
        const size = ownerIcnsFrameSizes[frame];
        return size === undefined ? undefined : argbFixture(size, 0);
    }
    if (options.wrongPixelsFrame === frame) {
        const size = ownerIcnsFrameSizes[frame];
        if (size === undefined) {
            return undefined;
        }
        if (frame === 'ic04' || frame === 'ic05') {
            return argbFixture(size);
        }
        return rgbaPng(size, size, () => ownerIconBackground);
    }
    if (options.highBitArgbFrame === frame) {
        const changed = Buffer.from(payload);
        changed[0] = changed[0]! | 0x80;
        return changed;
    }
    return payload;
}

function icnsFixture(
    frames: readonly string[] = ownerIcnsFrames,
    options: {
        highBitArgbFrame?: string;
        highBitFrame?: string;
        highBitMagic?: boolean;
        malformedFrame?: string;
        seamFrame?: string;
        wrongDimensionFrame?: string;
        wrongPixelsFrame?: string;
    } = {}
): Buffer {
    const includedFrames = new Set(frames);
    const chunks = repositoryIcnsChunks.flatMap(({ payload: originalPayload, type }) => {
        if (type !== 'info' && !includedFrames.has(type)) {
            return [];
        }
        const payload = type === 'info' ? originalPayload : icnsFixturePayload(type, originalPayload, options);
        if (payload === undefined) {
            throw new Error(`missing ICNS fixture payload: ${type}`);
        }
        const header = Buffer.alloc(8);
        header.write(type, 0, 'ascii');
        header.writeUInt32BE(8 + payload.length, 4);
        return [Buffer.concat([header, payload])];
    });
    const header = Buffer.alloc(8);
    header.write('icns', 0, 'ascii');
    header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
    const container = Buffer.concat([header, ...chunks]);
    if (options.highBitMagic) {
        container[0] = container[0]! | 0x80;
    }
    if (options.highBitFrame !== undefined) {
        let offset = 8;
        while (offset < container.length) {
            const length = container.readUInt32BE(offset + 4);
            if (container.toString('ascii', offset, offset + 4) === options.highBitFrame) {
                container[offset] = container[offset]! | 0x80;
                break;
            }
            offset += length;
        }
    }
    return container;
}

type IcoFixtureFrame = { payload: Buffer; size: number };

function readIcoFixtureFrames(container: Buffer): readonly IcoFixtureFrame[] {
    const count = container.readUInt16LE(4);
    const frames: IcoFixtureFrame[] = [];
    for (let index = 0; index < count; index += 1) {
        const offset = 6 + index * 16;
        const size = container[offset] === 0 ? 256 : container[offset];
        const length = container.readUInt32LE(offset + 8);
        const payloadOffset = container.readUInt32LE(offset + 12);
        frames.push({ payload: container.subarray(payloadOffset, payloadOffset + length), size });
    }
    return frames;
}

const repositoryIcoFrames = readIcoFixtureFrames(repositoryOwnerIco);

function icoFixturePayload(
    size: number,
    payload: Buffer | undefined,
    options: { malformedSize?: number; wrongDimensionSize?: number; wrongPixelsSize?: number }
): Buffer | undefined {
    if (options.malformedSize === size) {
        return Buffer.from([0]);
    }
    if (options.wrongDimensionSize === size) {
        return rgbaPng(1, 1, () => ownerIconBackground);
    }
    if (options.wrongPixelsSize === size) {
        return rgbaPng(size, size, () => ownerIconBackground);
    }
    return payload;
}

function icoFixture(
    frames: readonly number[] = ownerIcoFrames,
    options: {
        malformedSize?: number;
        overlap?: boolean;
        wrongDimensionSize?: number;
        wrongPixelsSize?: number;
    } = {}
): Buffer {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(frames.length, 4);
    const payloadOffset = 6 + frames.length * 16;
    const payloads = frames.map((size) => {
        const source = repositoryIcoFrames.find((frame) => frame.size === size)?.payload;
        const payload = icoFixturePayload(size, source, options);
        if (payload === undefined) {
            return rgbaPng(size, size, () => ownerIconBackground);
        }
        return payload;
    });
    let nextPayloadOffset = payloadOffset;
    const entries = frames.map((size, index) => {
        const payload = payloads[index];
        if (payload === undefined) {
            throw new Error(`missing ICO fixture payload: ${size}`);
        }
        const entry = Buffer.alloc(16);
        entry[0] = size === 256 ? 0 : size;
        entry[1] = size === 256 ? 0 : size;
        entry.writeUInt16LE(1, 4);
        entry.writeUInt16LE(32, 6);
        entry.writeUInt32LE(payload.length, 8);
        entry.writeUInt32LE(options.overlap && index === 1 ? payloadOffset : nextPayloadOffset, 12);
        nextPayloadOffset += payload.length;
        return entry;
    });
    return Buffer.concat([header, ...entries, ...payloads]);
}

function flipPngChunkCrc(png: Buffer, chunkType: string): Buffer {
    const changed = Buffer.from(png);
    let offset = 8;
    while (offset < changed.length) {
        const length = changed.readUInt32BE(offset);
        const type = changed.toString('ascii', offset + 4, offset + 8);
        if (type === chunkType) {
            changed[offset + 8 + length] ^= 0xff;
            return changed;
        }
        offset += 12 + length;
    }
    throw new Error(`missing PNG fixture chunk: ${chunkType}`);
}

type PngFixtureChunk = { data: Buffer; type: Buffer };

function readPngFixtureChunks(png: Buffer): readonly PngFixtureChunk[] {
    const chunks: PngFixtureChunk[] = [];
    let offset = 8;
    while (offset < png.length) {
        const length = png.readUInt32BE(offset);
        chunks.push({
            data: png.subarray(offset + 8, offset + 8 + length),
            type: png.subarray(offset + 4, offset + 8),
        });
        offset += 12 + length;
    }
    return chunks;
}

function pngFixture(chunks: readonly PngFixtureChunk[]): Buffer {
    return Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        ...chunks.map(({ data, type }) => rawPngChunk(type, data)),
    ]);
}

function pngChunkName(chunk: PngFixtureChunk): string {
    return chunk.type.toString('ascii');
}

function pngWithIdatBeforeHeader(png: Buffer): Buffer {
    const chunks = [...readPngFixtureChunks(png)];
    const headerIndex = chunks.findIndex((chunk) => pngChunkName(chunk) === 'IHDR');
    const imageDataIndex = chunks.findIndex((chunk) => pngChunkName(chunk) === 'IDAT');
    const header = chunks[headerIndex];
    const imageData = chunks[imageDataIndex];
    if (header === undefined || imageData === undefined) {
        throw new Error('PNG fixture lacks IHDR or IDAT');
    }
    chunks[headerIndex] = imageData;
    chunks[imageDataIndex] = header;
    return pngFixture(chunks);
}

function pngWithInterleavedIdat(png: Buffer): Buffer {
    const chunks = [...readPngFixtureChunks(png)];
    const firstImageData = chunks.findIndex((chunk) => pngChunkName(chunk) === 'IDAT');
    const secondImageData = chunks.findIndex(
        (chunk, index) => index > firstImageData && pngChunkName(chunk) === 'IDAT'
    );
    if (firstImageData < 0 || secondImageData < 0) {
        throw new Error('PNG fixture needs two IDAT chunks');
    }
    chunks.splice(secondImageData, 0, { data: Buffer.from('separator'), type: Buffer.from('tEXt', 'ascii') });
    return pngFixture(chunks);
}

function pngWithChunkAfterHeader(png: Buffer, type: Buffer): Buffer {
    const chunks = [...readPngFixtureChunks(png)];
    const headerIndex = chunks.findIndex((chunk) => pngChunkName(chunk) === 'IHDR');
    if (headerIndex < 0) {
        throw new Error('PNG fixture lacks IHDR');
    }
    chunks.splice(headerIndex + 1, 0, { data: Buffer.alloc(0), type });
    return pngFixture(chunks);
}

function pngWithTrailingCompressedBytes(png: Buffer): Buffer {
    const chunks = [...readPngFixtureChunks(png)];
    let finalImageData = -1;
    for (let index = 0; index < chunks.length; index += 1) {
        const candidate = chunks[index];
        if (candidate !== undefined && pngChunkName(candidate) === 'IDAT') {
            finalImageData = index;
        }
    }
    const chunk = chunks[finalImageData];
    if (chunk === undefined) {
        throw new Error('PNG fixture lacks IDAT');
    }
    chunks[finalImageData] = { data: Buffer.concat([chunk.data, Buffer.from([1, 2, 3])]), type: chunk.type };
    return pngFixture(chunks);
}

function oversizedIdatPng(): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        pngChunk('IHDR', header),
        pngChunk('IDAT', Buffer.alloc(ownerPngIdatByteLimit + 1)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

function writeOwnerVisualAssetFixture(
    root: string,
    options: {
        authority?: Buffer;
        canonical?: Buffer;
        icnsFrames?: readonly string[];
        icoFrames?: readonly number[];
        highBitIcnsArgbFrame?: string;
        highBitIcnsFrame?: string;
        highBitIcnsMagic?: boolean;
        malformedIcnsFrame?: string;
        malformedIcoSize?: number;
        overlappingIcoPayloads?: boolean;
        seamIcnsFrame?: string;
        wrongDimensionIcnsFrame?: string;
        wrongDimensionIcoSize?: number;
        wrongPixelsIcnsFrame?: string;
        wrongPixelsIcoSize?: number;
    } = {}
): void {
    mkdirSync(join(root, 'public/logo-parts'), { recursive: true });
    mkdirSync(join(root, 'build/icons/nested'), { recursive: true });
    const canonical = options.canonical ?? repositoryOwnerCanonical;
    const authority = options.authority ?? repositoryOwnerAuthority;

    writeFileSync(join(root, 'public/icon.png'), canonical);
    writeFileSync(join(root, 'sourdaw.png'), canonical);
    writeFileSync(join(root, 'public/icon-transparent.png'), authority);
    copyFileSync(join(repositoryRoot, 'public/favicon.ico'), join(root, 'public/favicon.ico'));
    copyFileSync(join(repositoryRoot, 'public/icon-192.png'), join(root, 'public/icon-192.png'));
    writeFileSync(join(root, 'public/logo-parts/p00.png'), 'part');
    writeFileSync(join(root, 'build/icons/icon.png'), canonical);
    writeFileSync(
        join(root, 'build/icons/icon.icns'),
        icnsFixture(options.icnsFrames, {
            highBitArgbFrame: options.highBitIcnsArgbFrame,
            highBitFrame: options.highBitIcnsFrame,
            highBitMagic: options.highBitIcnsMagic,
            malformedFrame: options.malformedIcnsFrame,
            seamFrame: options.seamIcnsFrame,
            wrongDimensionFrame: options.wrongDimensionIcnsFrame,
            wrongPixelsFrame: options.wrongPixelsIcnsFrame,
        })
    );
    writeFileSync(
        join(root, 'build/icons/icon.ico'),
        icoFixture(options.icoFrames, {
            malformedSize: options.malformedIcoSize,
            overlap: options.overlappingIcoPayloads,
            wrongDimensionSize: options.wrongDimensionIcoSize,
            wrongPixelsSize: options.wrongPixelsIcoSize,
        })
    );
    writeFileSync(join(root, 'build/icons/nested/icon.png'), canonical);
}

function expectedApacheTvmRawSource(path: string): string {
    const apacheTvmPrefix = 'public/legal/Apache-TVM/';
    const tvmFfiPrefix = `${apacheTvmPrefix}3rdparty/tvm-ffi/`;
    if (path.startsWith(tvmFfiPrefix)) {
        return `https://raw.githubusercontent.com/apache/tvm-ffi/${TVM_FFI_COMMIT}/${path.slice(tvmFfiPrefix.length)}`;
    }
    return `https://raw.githubusercontent.com/apache/tvm/${APACHE_TVM_COMMIT}/${path.slice(apacheTvmPrefix.length)}`;
}

function isConcreteWebLlmLegalPath(path: string): boolean {
    return path.startsWith(WEBLLM_LEGAL_PATH_PREFIX) && !path.endsWith('/');
}

function webLlmLegalSourceBuckets(sources: readonly string[]): Record<string, string[]> {
    return {
        apacheTvmRaw: sources
            .filter(
                (source) =>
                    source.startsWith('https://raw.githubusercontent.com/apache/tvm/') ||
                    source.startsWith('https://raw.githubusercontent.com/apache/tvm-ffi/')
            )
            .sort(),
        mlcLlmNotice: sources.filter((source) => source.startsWith('https://github.com/mlc-ai/mlc-llm/tree/')).sort(),
        qwenLicenseSet: sources.filter((source) => source.startsWith('https://huggingface.co/Qwen/')).sort(),
        webLlmLicense: sources.filter((source) => source.startsWith('https://github.com/mlc-ai/web-llm/blob/')).sort(),
    };
}

function webLlmLegalSourceKinds(path: string): string[] {
    if (path.startsWith('public/legal/Apache-TVM/')) {
        return ['apacheTvmRaw'];
    }
    if (path === 'public/legal/MLC-LLM-NOTICE.txt') {
        return ['mlcLlmNotice'];
    }
    if (path === 'public/legal/Qwen-NOTICE.txt') {
        return ['qwenLicenseSet'];
    }
    if (path === 'public/legal/Apache-2.0.txt') {
        return ['webLlmLicense'];
    }
    if (path === 'public/legal/THIRD-PARTY-NOTICES.md') {
        return ['apacheTvmRaw', 'mlcLlmNotice', 'qwenLicenseSet', 'webLlmLicense'];
    }
    throw new Error(`unexpected WebLLM legal path in oracle: ${path}`);
}

function webLlmLegalClosureOracle() {
    const surface = readReleaseInventory(repositoryRoot).surfaces.find(({ id }) => id === WEBLLM_SURFACE_ID);
    if (surface === undefined) {
        throw new Error(`missing ${WEBLLM_SURFACE_ID} surface`);
    }
    const legalPaths = surface.paths.filter(isConcreteWebLlmLegalPath).sort();
    return {
        legalPaths,
        sourceBuckets: webLlmLegalSourceBuckets(surface.sources),
        pathSourceKinds: Object.fromEntries(legalPaths.map((path) => [path, webLlmLegalSourceKinds(path)])),
        pathDigests: surface.digests.filter((digest) => /^sha256:[0-9a-f]{64}:public\/legal\//u.test(digest)).sort(),
    };
}

function writeDdspModelContractFixture(root: string, manifest: string): void {
    const manifestPath = 'src/modules/BrowserAi/models/DdspArtifactManifest.ts';
    for (const [path, value] of [
        [manifestPath, manifest],
        ['electron/protocol.ts', 'protocol'],
        ['public/legal/THIRD-PARTY-NOTICES.md', 'notice'],
        [DDSP_ADMISSION_DECISION_PATH, `Admitted \`DdspArtifactManifest\` SHA-256: \`${sha256(manifest)}\``],
        ...ddspModelEnforcementPaths.map((path) => [path, `baseline:${path}`] as const),
    ] as const) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), value);
    }
}

function wasmWithFunctionExport(name: string): Uint8Array {
    const encodedName = new TextEncoder().encode(name);
    if (encodedName.length >= 128) {
        throw new RangeError('fixture export name must fit in one unsigned LEB128 byte');
    }
    const exportPayload = [1, encodedName.length, ...encodedName, 0, 0];
    return Uint8Array.from([
        0x00,
        0x61,
        0x73,
        0x6d,
        0x01,
        0x00,
        0x00,
        0x00,
        0x01,
        0x04,
        0x01,
        0x60,
        0x00,
        0x00,
        0x03,
        0x02,
        0x01,
        0x00,
        0x07,
        exportPayload.length,
        ...exportPayload,
        0x0a,
        0x04,
        0x01,
        0x02,
        0x00,
        0x0b,
    ]);
}

function grandBouleTextConstructorFixture(path: string): string {
    if (path.endsWith('_bg.wasm.d.ts')) {
        return 'export const grandbouleinstance_new: (a: number, b: number) => number;';
    }
    if (path.endsWith('.d.ts')) {
        return `export class GrandBouleInstance {
            constructor(sample_rate: number, voice_count: number);
        }`;
    }
    return `export class GrandBouleInstance {
        constructor(sample_rate, voice_count) {
            const ret = wasm.grandbouleinstance_new(sample_rate, voice_count);
        }
    }`;
}

function writeDistributedWasmFixture(root: string, binaryExport = 'allowed_instance_new'): void {
    for (const path of repositoryDistributedArtifacts.textArtifacts) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(
            join(root, path),
            repositoryDawDspArtifacts.has(path) && !path.endsWith('/package.json')
                ? grandBouleTextConstructorFixture(path)
                : 'export class AllowedInstance {}'
        );
    }
    for (const path of repositoryDistributedArtifacts.wasmArtifacts) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(
            join(root, path),
            wasmWithFunctionExport(repositoryDawDspArtifacts.has(path) ? 'grandbouleinstance_new' : binaryExport)
        );
    }
    mkdirSync(join(root, 'public/wasm'), { recursive: true });
    writeFileSync(
        join(root, 'public/wasm/manifest.json'),
        JSON.stringify({
            comment: 'fixture',
            toolchain: { wasmPack: 'fixture', wasmBindgen: 'fixture', rustToolchain: 'fixture', wasmOpt: 'fixture' },
            packages: Object.fromEntries(
                wasmArtifacts.packages.map((entry) => [
                    entry.id,
                    {
                        crate: entry.crateDir,
                        crateSourceHash: 'sha256:fixture',
                        schemaHash: 'fixture',
                        artifacts: Object.fromEntries(entry.artifacts.map((path) => [path, 'sha256:fixture'])),
                    },
                ])
            ),
        })
    );
}

function writeGrandBouleReleaseFixture(root: string): void {
    for (const [path, contents] of [
        [
            'crates/daw-dsp/src/grand_boule/engine.rs',
            `struct GrandBouleEngine {}
impl GrandBouleEngine {
    pub fn new(sample_rate: f32, voice_count: usize) -> Self {
        Self {
            hammer_hardness_scale: 0.92,
            hammer_mass_scale: 1.08,
            soundboard_brightness: 0.48,
            sympathetic_level: 0.58,
            body_resonance: 0.52,
            tone_color: -0.08,
        }
    }
}`,
        ],
        ['crates/daw-dsp/src/grand_boule/attack_sampler.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/duplex.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/hammer.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/longitudinal.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/mechanical_noise.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/midi2.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/mod.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/pedals.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/radiation.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/string.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/sympathetic.rs', 'project source'],
        ['crates/daw-dsp/src/grand_boule/voice.rs', 'project source'],
        [
            'crates/daw-dsp/src/grand_boule/soundboard.rs',
            `const FIR_STAGE_COUNT: usize = 12;
struct FeedForwardDelay {}
const WARM_LEFT: KernelSpec = KernelSpec {};
const WARM_RIGHT: KernelSpec = KernelSpec {};
const OPEN_LEFT: KernelSpec = KernelSpec {};
const OPEN_RIGHT: KernelSpec = KernelSpec {};
fn tick() { input + delayed * self.delayed_gain; }`,
        ],
        [
            'crates/daw-dsp/src/grand_boule/parameters.rs',
            `//! Project tuning curves and standard piano mappings for Grand Boule.
fn curve(key: u32) {
    let t = ((key as f32 - 1.0) / 87.0).clamp(0.0, 1.0);
    let exponent = 7.86_f32 + 1.88 * t.powf(1.32) + 0.14 * t * (1.0 - t);
}`,
        ],
        [
            'crates/daw-dsp/src/grand_boule/coupled_strings.rs',
            `//! No body or soundboard property enters string coefficient derivation.
struct PolarizationDecay { prompt_hz: f32, aftersound_hz: f32 }
const POLARIZATION_TRANSFER_GAIN: f32 = 30.0;
const AFTERSOUND_MIX: f32 = 0.7;
fn polarization_decay_hz(note_frequency_hz: f32) -> PolarizationDecay {
    let register = note_frequency_hz;
    PolarizationDecay {
        prompt_hz: 0.58 + 0.72 * register + 7.2 * register.powf(2.4),
        aftersound_hz: 0.012 + 0.025 * register + 0.105 * register * register,
    }
}`,
        ],
        ['src/modules/GrandBoule/AGENTS.md', 'fixture provider policy'],
        ['src/modules/GrandBoule/models/GrandBouleConfig.ts', 'export type GrandBouleConfig = {};'],
        [
            'src/modules/GrandBoule/models/GrandBouleMorphState.ts',
            `export const voicings = [
                { id: 'balanced-grand', name: 'Balanced Grand', hammerHardnessScale: 0.92, hammerMassScale: 1.08, soundboardBrightness: 0.48, sympatheticLevel: 0.58, bodyResonance: 0.52, toneColor: -0.08
                },
                { id: 'mellow-grand', name: 'Mellow Grand', hammerHardnessScale: 0.72, hammerMassScale: 1.25, soundboardBrightness: 0.32, sympatheticLevel: 0.74, bodyResonance: 0.82, toneColor: -0.58
                },
                { id: 'clear-grand', name: 'Clear Grand', hammerHardnessScale: 1.34, hammerMassScale: 0.82, soundboardBrightness: 0.78, sympatheticLevel: 0.36, bodyResonance: 0.42, toneColor: 0.56
                },
                { id: 'singing-grand', name: 'Singing Grand', hammerHardnessScale: 1.12, hammerMassScale: 0.94, soundboardBrightness: 0.68, sympatheticLevel: 0.66, bodyResonance: 0.57, toneColor: 0.28
                },
            ];
            `,
        ],
        [
            'src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts',
            "export const GRAND_BOULE_DESCRIPTOR = { id: 'grand-boule' };",
        ],
        ['src/infra/release/deviceReleaseAdmission.ts', 'export const withheld = new Set<string>();'],
        ['src/modules/AudioEngine/engine/GrandBouleNode.ts', 'export class GrandBouleNode {}'],
        ['src/modules/AudioEngine/models/GrandBouleRingProtocol.ts', 'export const ring = 1;'],
        ['src/modules/AudioEngine/workers/grandBouleEngineWorker.ts', 'export const worker = 1;'],
        ['src/modules/AudioEngine/worklets/grandBouleEngineCore.ts', 'export const core = 1;'],
        ['src/modules/AudioEngine/worklets/grandBouleProcessor.ts', 'export const processor = 1;'],
        ['.agents/decisions/0036-readmit-grand-boule.md', '# Grand Boule admission'],
        ['src/modules/Arrangement/useCases/preset/sidebarInstrumentPresets.ts', 'export const presets = [];'],
        ['src/modules/ContentBrowser/presentations/views/Sidebar/InstrumentsTab.tsx', 'export const tab = 1;'],
        [
            'src/modules/AudioEngine/repositories/deviceStrategy/nativeDspDeviceFactories.ts',
            'export const factories = 1;',
        ],
        [
            'src/modules/AudioEngine/repositories/deviceStrategy/unrenderableCatalogDeviceTypes.ts',
            'export const types = 1;',
        ],
        ['src/utils/nativeDspDeviceTypes.ts', 'export const types = 1;'],
        ['src/modules/AudioEngine/engine/wasmDeviceRegistry.ts', 'export const registry = 1;'],
        ['src/modules/AudioEngine/models/AudioEngineState.ts', 'export const state = 1;'],
        ['src/modules/AudioEngine/repositories/createWebAudioEngine.ts', 'export const engine = 1;'],
        ['src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts', 'export const schedule = 1;'],
        ['src/app/bootstrap.ts', 'export const bootstrap = 1;'],
        ['src/app/getProductionCommandHandlerMaps.ts', 'export const handlers = 1;'],
        ['src/utils/handlerContract.ts', 'export type Action = unknown;'],
        ['src/modules/Command/useCases/versionedCommandArgumentKeys.ts', 'export const keys = [];'],
        ['src/modules/Arrangement/useCases/index.ts', 'export const arrangement = 1;'],
        ['src/modules/Arrangement/useCases/device/setDeviceState.ts', 'export const setDeviceState = 1;'],
        ['src/modules/GrandBoule/AGENTS.md', 'Grand Boule module guidance'],
        ['src/app/prepareOfflineDeviceSetup.ts', 'export const offline = 1;'],
        ['src/modules/AudioEngine/useCases/buildDeviceChain.ts', 'export const chain = 1;'],
        ['src/modules/GrandBoule/useCases/prepareOfflineGrandBoule.ts', 'export const prepare = 1;'],
        ['crates/daw-dsp/benches/quantum.rs', 'fn grand_boule() {}'],
        ['crates/daw-dsp/benches/wasm/deviceRecipes.js', 'export const grandBoule = 1;'],
        ['crates/daw-dsp/benches/wasm/quantumCostProcessor.js', 'export const processor = 1;'],
        ['crates/daw-dsp/benches/wasm/run.mjs', 'export const runner = 1;'],
        ['crates/daw-dsp/benches/wasm/renderTable.mjs', 'export const renderer = 1;'],
        ['crates/daw-dsp/benches/wasm/renderTable.d.mts', 'export function renderGeneratedRegion(): string;'],
        ['crates/daw-dsp/benches/quantum-cost-table.json', '{}'],
        ['crates/daw-dsp/benches/quantum-cost-table.md', '# retained measurement'],
        ['crates/daw-dsp/tests/quantum_bench_census.rs', 'fn census() {}'],
        ['scripts/checkReleaseInventory.ts', 'export const check = 1;'],
    ] as const) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), contents);
    }
    for (const path of GRAND_BOULE_PROVIDER_POLICY_SYMLINK_PATHS) {
        const linkPath = join(root, path);
        rmSync(linkPath, { force: true });
        symlinkSync('AGENTS.md', linkPath);
    }
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    let hasStagedChanges = true;
    try {
        execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: root, stdio: 'ignore' });
        hasStagedChanges = false;
    } catch {
        // A fixture reset has changes to commit; an unchanged fixture is already current.
    }
    if (hasStagedChanges) {
        execFileSync(
            'git',
            ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'source'],
            { cwd: root }
        );
    }
}

const INDEPENDENT_GRAND_BOULE_PROJECT_STATE_PATHS = [
    'src/modules/GrandBoule',
    'src/modules/Command/useCases/versionedCommandArgumentKeys.ts',
    'src/modules/Arrangement/useCases/index.ts',
    'src/modules/Arrangement/useCases/device/setDeviceState.ts',
    'src/app/bootstrap.ts',
    'src/app/getProductionCommandHandlerMaps.ts',
    'src/utils/handlerContract.ts',
    ...GRAND_BOULE_PROVIDER_POLICY_SYMLINK_PATHS.map((path) => `:(exclude)${path}`),
];

function readIndependentTrackedEntry(absolutePath: string): Buffer {
    let fileDescriptor: number | undefined;
    try {
        fileDescriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        return readFileSync(fileDescriptor);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
            return readlinkSync(absolutePath, { encoding: 'buffer' });
        }
        throw error;
    } finally {
        if (fileDescriptor !== undefined) {
            closeSync(fileDescriptor);
        }
    }
}

function independentTrackedSetSha256(root: string, pathspecs: readonly string[], label: string): string {
    const files = execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], {
        cwd: root,
        encoding: 'utf8',
    })
        .split('\0')
        .filter(Boolean)
        .sort();
    const hash = createHash('sha256');
    for (const path of files) {
        const absolutePath = join(root, path);
        hash.update(path);
        hash.update('\0');
        hash.update(readIndependentTrackedEntry(absolutePath));
        hash.update('\0');
    }
    return `tracked-set-sha256:${hash.digest('hex')}:${label}`;
}

function independentGrandBouleProjectStateDigest(root: string): string {
    return independentTrackedSetSha256(root, INDEPENDENT_GRAND_BOULE_PROJECT_STATE_PATHS, 'grand-boule-project-state');
}

function findDigestByLabel(digests: readonly string[], label: string): string {
    const digest = digests.find((candidate) => candidate.endsWith(`:${label}`));
    if (digest === undefined) {
        throw new Error(`missing digest label ${label}`);
    }
    return digest;
}

function initializeIsolatedGitFixture(root: string): void {
    execFileSync('git', ['-c', 'trace2.eventTarget=/dev/null', 'init', '--quiet'], { cwd: root });
    execFileSync(
        'git',
        ['-c', 'trace2.eventTarget=/dev/null', 'config', '--local', 'trace2.eventTarget', '/dev/null'],
        { cwd: root }
    );
}

function writeGrandBouleMeasurementFixture(root: string): { jsonPath: string; revision: string } {
    const sourcePaths = [
        'crates/daw-dsp/benches/quantum.rs',
        'crates/daw-dsp/benches/wasm/deviceRecipes.js',
        'crates/daw-dsp/benches/wasm/quantumCostProcessor.js',
        'public/wasm/daw-dsp/daw_dsp_bg.wasm',
    ];
    for (const path of sourcePaths) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), `measured source ${path}`);
    }
    initializeIsolatedGitFixture(root);
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
        'git',
        ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'source'],
        {
            cwd: root,
        }
    );
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const sourceDigests = Object.fromEntries(
        sourcePaths.map((path) => [
            path,
            createHash('sha256')
                .update(readFileSync(join(root, path)))
                .digest('hex'),
        ])
    );
    const detail = 'active_voices() = 64, expected 64 from 64 note-ons, output RMS 1.000e-1';
    const data = {
        machine: {
            cpu: 'Fixture CPU',
            hardwareModel: 'Fixture Model',
            performanceCores: '4',
            efficiencyCores: '0',
            memoryGb: 16,
            os: 'Fixture OS',
            arch: 'arm64',
            gitBase: 'fixture-base',
            workingTree: 'clean',
            logicalCores: 4,
            gitSha: revision,
            takenAt: '2026-08-23T00:00:00.000Z',
        },
        sourceRevision: revision,
        sourceDigests,
        browser: 'fixture-browser',
        userAgent: 'fixture-agent',
        budgetMs: 2.666,
        options: { warmupQuanta: 4, measureQuanta: 8 },
        load: { before: 1.25, after: 1.5 },
        referenceProject: {
            audioThread: [['grand_boule_ring_consumer', 1]],
            worker: [['grand_boule', 1]],
            audioFloorMs: 0.1,
            audioFloorPartialFrom: [],
            audioUpperBoundMs: 1,
            audioWorstQuantumUpperMs: 2.1,
            audioMedianMs: 0.9,
            meanLoad: 1.5,
            workerFloorMs: 1.8,
            workerMedianMs: 2.2,
        },
        rows: [
            {
                id: 'grand_boule',
                label: 'Grand Boule (64 voices) — production Worker cost site',
                note: 'fixture',
                costSite: 'worker',
                warmVerify: { ok: true, detail },
                lateVerify: { ok: true, detail },
                stats: { median: 2.125, floor: 1.875, min: 1.8 },
                load: { mean: 1.5 },
                zeroFraction: 0,
                stationary: true,
                floorMeasurable: true,
                dutyCycle: null,
                calibration: { segments: 1, medianTicksPerMs: 1000, spreadPct: 0 },
                wallRatio: 0.8,
            },
        ],
    };
    const jsonPath = join(root, 'crates/daw-dsp/benches/quantum-cost-table.json');
    const markdownPath = join(root, 'crates/daw-dsp/benches/quantum-cost-table.md');
    writeFileSync(jsonPath, JSON.stringify(data));
    writeFileSync(markdownPath, renderGeneratedRegion(data));
    return { jsonPath, revision };
}

function writeShallowGrandBouleMeasurementFixture(
    root: string,
    afterDirectoriesCreated?: (directories: { clone: string; remote: string }) => void
): {
    clone: string;
    remote: string;
    revision: string;
    jsonPath: string;
} {
    writeGrandBouleMeasurementFixture(root);
    execFileSync(
        'git',
        ['add', 'crates/daw-dsp/benches/quantum-cost-table.json', 'crates/daw-dsp/benches/quantum-cost-table.md'],
        {
            cwd: root,
        }
    );
    execFileSync(
        'git',
        ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'measurement'],
        {
            cwd: root,
        }
    );
    const revision = execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: root, encoding: 'utf8' }).trim();
    writeFileSync(join(root, 'fixture-tip.txt'), 'newer tip');
    execFileSync('git', ['add', 'fixture-tip.txt'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'tip'], {
        cwd: root,
    });

    const remote = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-remote-'));
    let clone: string | undefined;
    try {
        clone = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-shallow-'));
        afterDirectoriesCreated?.({ clone, remote });
        rmSync(clone, { recursive: true, force: true });
        execFileSync('git', ['-c', 'trace2.eventTarget=/dev/null', 'init', '--bare', '--quiet', remote]);
        execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root });
        execFileSync('git', ['push', '--quiet', 'origin', 'HEAD:refs/heads/main'], { cwd: root });
        execFileSync('git', ['-c', 'trace2.eventTarget=/dev/null', 'symbolic-ref', 'HEAD', 'refs/heads/main'], {
            cwd: remote,
        });
        execFileSync(
            'git',
            ['-c', 'trace2.eventTarget=/dev/null', 'clone', '--depth', '1', `file://${remote}`, clone],
            {
                stdio: 'ignore',
            }
        );
        execFileSync(
            'git',
            ['-c', 'trace2.eventTarget=/dev/null', 'config', '--local', 'trace2.eventTarget', '/dev/null'],
            { cwd: clone }
        );
        return { clone, remote, revision, jsonPath: join(clone, 'crates/daw-dsp/benches/quantum-cost-table.json') };
    } catch (error) {
        if (clone !== undefined) {
            rmSync(clone, { recursive: true, force: true });
        }
        rmSync(remote, { recursive: true, force: true });
        throw error;
    }
}

function inventory(): ReleaseInventory {
    return {
        schemaVersion: 1,
        surfaces: [
            {
                id: 'runtime',
                kind: 'source',
                retention: 'keep',
                owner: 'OS-01',
                releaseModes: ['source'],
                paths: ['public/**', 'src/**', ...REQUIRED_SNAPSHOT_PATHS],
                sources: ['git:example/repository'],
                revisions: ['deadbeef'],
                digests: ['sha256:example'],
                licenses: ['Apache-2.0'],
                productSurfaces: ['source distribution'],
                evidence: ['package.json'],
                obligations: ['Preserve attribution.'],
            },
        ],
        snapshots: REQUIRED_SNAPSHOT_PATHS.map((path) => ({ path, sha256: fixtureDigest })),
        externalReferences: [{ surface: 'runtime', file: 'src/provider.ts', value: 'https://provider.example/v1' }],
        marks: [],
    };
}

function snapshot(): RepositorySnapshot {
    return {
        releaseFiles: [...new Set([...REQUIRED_SNAPSHOT_PATHS, 'public/icon.png', 'src/provider.ts'])],
        externalReferences: [{ file: 'src/provider.ts', value: 'https://provider.example/v1' }],
        fileDigests: Object.fromEntries(REQUIRED_SNAPSHOT_PATHS.map((path) => [path, fixtureDigest])),
        markPaths: {},
    };
}

describe('release inventory', () => {
    it('includes the complete Grand Boule Rust module in the wasm32 crate graph', () => {
        expect(() => assertGrandBouleRustWasmBoundary(repositoryRoot)).not.toThrow();

        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-rust-boundary-'));
        try {
            const lib = join(root, 'crates/daw-dsp/src/lib.rs');
            mkdirSync(dirname(lib), { recursive: true });
            writeFileSync(lib, '#[cfg(not(target_arch = "wasm32"))]\npub mod grand_boule;\n');
            expect(() => assertGrandBouleRustWasmBoundary(root)).toThrow(
                'Grand Boule must be included in the wasm32 crate graph at crates/daw-dsp/src/lib.rs'
            );
            writeFileSync(lib, 'pub mod grand_boule;\npub mod grand_boule;\n');
            expect(() => assertGrandBouleRustWasmBoundary(root)).toThrow(
                'Grand Boule must be included in the wasm32 crate graph at crates/daw-dsp/src/lib.rs'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('pins the Grand Boule FIR body and neutral project provenance source shape', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-design-around-'));
        writeGrandBouleReleaseFixture(root);

        try {
            expect(() => assertGrandBouleDesignAroundSource(root)).not.toThrow();

            const soundboardPath = join(root, 'crates/daw-dsp/src/grand_boule/soundboard.rs');
            const soundboardSource = readFileSync(soundboardPath, 'utf8');
            writeFileSync(soundboardPath, 'const SOUNDBOARD_MODES: usize = 192; fn rebuild_modes() {}');
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('Grand Boule FIR body contract');

            writeFileSync(soundboardPath, soundboardSource);
            writeFileSync(
                join(root, 'src/modules/GrandBoule/models/GrandBouleMorphState.ts'),
                `export const model = { id: 'balanced-grand', name: 'Steinway Model D' };`
            );
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('product voicing contract');

            writeGrandBouleReleaseFixture(root);
            writeFileSync(
                join(root, 'crates/daw-dsp/src/grand_boule/coupled_strings.rs'),
                'fn sigma_bridge_hz(fundamental_hz: f32) -> f32 { 0.8 + fundamental_hz * 0.004 }'
            );
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('polarization-decay');

            writeGrandBouleReleaseFixture(root);
            writeFileSync(
                join(root, 'crates/daw-dsp/src/grand_boule/parameters.rs'),
                '//! Project tuning curves and standard piano mappings\nfn curve(key: u32) { let exponent = 8.0_f32 + 0.020 * (key as f32 - 1.0); }'
            );
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('hammer-stiffness');

            writeGrandBouleReleaseFixture(root);
            const voicingsPath = join(root, 'src/modules/GrandBoule/models/GrandBouleMorphState.ts');
            writeFileSync(
                voicingsPath,
                readFileSync(voicingsPath, 'utf8').replace(
                    'hammerHardnessScale: 0.92, hammerMassScale: 1.08, soundboardBrightness: 0.48, sympatheticLevel: 0.58, bodyResonance: 0.52, toneColor: -0.08',
                    'hammerHardnessScale: 1, hammerMassScale: 1, soundboardBrightness: 0.55, sympatheticLevel: 0.5, bodyResonance: 0.6, toneColor: 0'
                )
            );
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('legacy branded tuple');

            writeGrandBouleReleaseFixture(root);
            writeFileSync(voicingsPath, `${readFileSync(voicingsPath, 'utf8')}\nconst oldId = 'steinway-d';\n`);
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('legacy branded id');

            writeGrandBouleReleaseFixture(root);
            const enginePath = join(root, 'crates/daw-dsp/src/grand_boule/engine.rs');
            writeFileSync(
                enginePath,
                `// hammer_hardness_scale: 0.92, hammer_mass_scale: 1.08
                 const DECOY: &str = "soundboard_brightness: 0.48";
                 struct GrandBouleEngine {}
                 impl GrandBouleEngine {
                   pub fn new(sample_rate: f32, voice_count: usize) -> Self {
                     Self { hammer_hardness_scale: 1.0, hammer_mass_scale: 1.0, soundboard_brightness: 0.55,
                       sympathetic_level: 0.5, body_resonance: 0.6, tone_color: 0.0 }
                   }
                 }`
            );
            expect(() => assertGrandBouleDesignAroundSource(root)).toThrow('Rust constructor');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('exposes Grand Boule construction from every distributed daw-dsp WASM surface', () => {
        expect(() => assertGrandBouleReleasedInWasm(repositoryRoot)).not.toThrow();
    });

    it.each(
        repositoryDistributedArtifacts.textArtifacts.filter(
            (path) => repositoryDawDspArtifacts.has(path) && !path.endsWith('/package.json')
        )
    )('rejects a missing Grand Boule construction path in declared daw-dsp text artifact %s', (path) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-text-'));

        try {
            writeDistributedWasmFixture(root);
            writeFileSync(join(root, path), 'export class AllowedInstance {}');
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                `Grand Boule constructor must be exposed exactly by distributed daw-dsp WASM surface ${path}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(
        repositoryDistributedArtifacts.textArtifacts.filter(
            (path) => repositoryDawDspArtifacts.has(path) && !path.endsWith('/package.json')
        )
    )('rejects a Grand Boule marker without the exact constructor in %s', (path) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-marker-'));
        try {
            writeDistributedWasmFixture(root);
            writeFileSync(join(root, path), 'export const marker = "GrandBouleInstance grandbouleinstance_new";');
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                `Grand Boule constructor must be exposed exactly by distributed daw-dsp WASM surface ${path}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(
        repositoryDistributedArtifacts.textArtifacts.filter(
            (path) =>
                repositoryDawDspArtifacts.has(path) &&
                !path.endsWith('/package.json') &&
                !path.endsWith('_bg.wasm.d.ts')
        )
    )('rejects a Grand Boule class whose constructor text belongs to a decoy class in %s', (path) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-decoy-'));
        try {
            writeDistributedWasmFixture(root);
            writeFileSync(
                join(root, path),
                path.endsWith('.d.ts')
                    ? `export class GrandBouleInstance {}
                       export class Decoy { constructor(sample_rate: number, voice_count: number); }`
                    : `export class GrandBouleInstance {}
                       export class Decoy {
                           constructor(sample_rate, voice_count) {
                               const ret = wasm.grandbouleinstance_new(sample_rate, voice_count);
                           }
                       }`
            );
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                `Grand Boule constructor must be exposed exactly by distributed daw-dsp WASM surface ${path}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(
        repositoryDistributedArtifacts.textArtifacts.filter(
            (path) => repositoryDawDspArtifacts.has(path) && path.endsWith('.js')
        )
    )('rejects unreachable or nested constructor calls in %s', (path) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-unreachable-'));
        try {
            writeDistributedWasmFixture(root);
            writeFileSync(
                join(root, path),
                `export class GrandBouleInstance {
                    constructor(sample_rate, voice_count) {
                        return;
                        if (false) wasm.grandbouleinstance_new(sample_rate, voice_count);
                    }
                }`
            );
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                `Grand Boule constructor must be exposed exactly by distributed daw-dsp WASM surface ${path}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(repositoryDistributedArtifacts.wasmArtifacts.filter((path) => repositoryDawDspArtifacts.has(path)))(
        'rejects a missing Grand Boule export in declared daw-dsp binary artifact %s',
        (path) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-binary-'));

            try {
                writeDistributedWasmFixture(root);
                writeFileSync(join(root, path), wasmWithFunctionExport('allowed_instance_new'));
                expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                    `Grand Boule constructor export must be exposed by distributed daw-dsp WASM binary ${path}`
                );
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it.each(repositoryDistributedArtifacts.wasmArtifacts.filter((path) => repositoryDawDspArtifacts.has(path)))(
        'rejects a marker-only Grand Boule binary export in %s',
        (path) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-binary-marker-'));
            try {
                writeDistributedWasmFixture(root);
                writeFileSync(join(root, path), wasmWithFunctionExport('grandbouleinstance_marker'));
                expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                    `Grand Boule constructor export must be exposed by distributed daw-dsp WASM binary ${path}`
                );
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it.each([
        ['public/wasm/hostile-extra.js', 'export class GrandBouleInstance {}', 'distributed public WASM tree'],
        [
            'public/wasm/proof-chamber/nested/hostile-extra.wasm',
            wasmWithFunctionExport('grandbouleinstance_new'),
            'distributed public WASM tree',
        ],
        [
            'src/modules/AudioEngine/wasm/hostile-extra.js',
            'export class GrandBouleInstance {}',
            'distributed AudioEngine WASM mirror',
        ],
        [
            'src/modules/AudioEngine/wasm/nested/hostile-extra.wasm',
            wasmWithFunctionExport('grandbouleinstance_new'),
            'distributed AudioEngine WASM mirror',
        ],
        [
            'src/modules/AudioEngine/wasm/__tests__/hostile-extra.js',
            'export class GrandBouleInstance {}',
            'distributed AudioEngine WASM mirror',
        ],
        [
            'src/modules/AudioEngine/wasm/__tests__/hostile-extra.wasm',
            wasmWithFunctionExport('grandbouleinstance_new'),
            'distributed AudioEngine WASM mirror',
        ],
    ])('rejects unmanifested distributed sidecar %s', (path, contents, label) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-'));

        try {
            writeDistributedWasmFixture(root);
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), contents);
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(`${label} has unexpected artifact ${path}`);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects unexpected manifest packages and artifact paths before scanning their bytes', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-manifest-'));

        try {
            writeDistributedWasmFixture(root);
            const manifestPath = join(root, 'public/wasm/manifest.json');
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WasmManifest;
            manifest.packages.hostile = {
                crate: 'crates/hostile',
                crateSourceHash: 'sha256:fixture',
                schemaHash: 'fixture',
                artifacts: {},
            };
            writeFileSync(manifestPath, JSON.stringify(manifest));
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow('WASM manifest has unexpected package hostile');

            writeDistributedWasmFixture(root);
            const changed = JSON.parse(readFileSync(manifestPath, 'utf8')) as WasmManifest;
            changed.packages['proof-chamber']!.artifacts['public/wasm/hostile.js'] = 'sha256:fixture';
            writeFileSync(manifestPath, JSON.stringify(changed));
            expect(() => assertGrandBouleReleasedInWasm(root)).toThrow(
                'WASM manifest package proof-chamber has unexpected artifact public/wasm/hostile.js'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('composes the DDSP TF.js runtime into live release inventory validation', { timeout: 20_000 }, () => {
        expect(checkReleaseInventory(process.cwd()).validatedSurfaceIds).toContain('ddsp-tfjs-runtime');
    });

    it('pins the WebLLM legal closure to exact paths, source buckets, and path-addressed digests', () => {
        expect(sha256(JSON.stringify(webLlmLegalClosureOracle()))).toBe(WEBLLM_LEGAL_CLOSURE_DIGEST);
    });

    it('binds every admitted Apache-TVM legal file to its immutable source bytes and public notice link', () => {
        const inventory = JSON.parse(
            readFileSync(join(repositoryRoot, 'release/open-source-inventory.json'), 'utf8')
        ) as ReleaseInventory;
        const surface = inventory.surfaces.find(({ id }) => id === WEBLLM_SURFACE_ID);
        const notice = readFileSync(join(repositoryRoot, 'public/legal/THIRD-PARTY-NOTICES.md'), 'utf8');
        const apacheTvmPaths =
            surface?.paths.filter((path) => path.startsWith('public/legal/Apache-TVM/') && !path.endsWith('/')) ?? [];

        expect(surface).toBeDefined();
        expect(apacheTvmPaths).toEqual(
            expect.arrayContaining([
                'public/legal/Apache-TVM/LICENSE',
                'public/legal/Apache-TVM/NOTICE',
                'public/legal/Apache-TVM/3rdparty/tvm-ffi/LICENSE',
                'public/legal/Apache-TVM/3rdparty/tvm-ffi/NOTICE',
            ])
        );

        for (const path of apacheTvmPaths) {
            const fileSha = createHash('sha256')
                .update(readFileSync(join(repositoryRoot, path)))
                .digest('hex');
            expect(surface?.sources).toContain(expectedApacheTvmRawSource(path));
            expect(surface?.digests).toContain(`sha256:${fileSha}:${path}`);
            expect(notice).toContain(`(./${path.replace('public/legal/', '')})`);
        }
    });

    it('should reject nested tvm-ffi legal byte drift', () => {
        const path = 'public/legal/Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.dlpack.txt';
        const value = inventory();
        value.surfaces[0]!.digests = [`sha256:${fixtureDigest}:${path}`];
        const changed = snapshot();
        changed.releaseFiles.push(path);
        changed.fileDigests[path] = 'b'.repeat(64);

        expect(validateReleaseInventory(value, changed)).toContain(`runtime: path-addressed digest drifted: ${path}`);
    });

    it('should reject a path-addressed digest with a mistyped repository path', () => {
        const path = 'public/legal/Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.dlpak.txt';
        const value = inventory();
        value.surfaces[0]!.digests = [`sha256:${fixtureDigest}:${path}`];

        expect(validateReleaseInventory(value, snapshot())).toContain(
            `runtime: path-addressed digest target is missing or untracked: ${path}`
        );
    });

    it('rejects non-canonical path-addressed digest paths before snapshotting them', () => {
        const value = inventory();
        const paths = [
            '/outside-root.txt',
            'public/legal/../outside.txt',
            'public//legal/notice.txt',
            'C:public/legal/Qwen-NOTICE.txt',
            'C:\\outside.txt',
            '\\\\server\\share\\notice.txt',
            'public\\legal\\notice.txt',
        ];
        value.surfaces[0]!.digests = paths.map((path) => `sha256:${fixtureDigest}:${path}`);
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-noncanonical-'));

        try {
            writeFileSync(join(root, 'provider.ts'), 'provider');
            const changed = loadRepositorySnapshot(root, value, ['provider.ts']);

            for (const path of paths) {
                expect(changed.fileDigests[path]).toBeUndefined();
            }
            expect(validateReleaseInventory(value, changed)).toEqual(
                expect.arrayContaining(
                    paths.map((path) => `runtime: path-addressed digest path must be normalized and relative: ${path}`)
                )
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('does not read unsafe or untracked path-addressed digest targets', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-unreadable-digest-'));
        const root = join(base, 'repository');
        const trackedPath = 'provider.ts';
        const unsafePath = '../outside.txt';
        const untrackedPath = 'public/legal/untracked.txt';
        const value: ReleaseInventory = {
            schemaVersion: 1,
            surfaces: [
                {
                    id: 'runtime',
                    kind: 'source',
                    retention: 'keep',
                    owner: 'OS-01',
                    releaseModes: ['source'],
                    paths: [trackedPath],
                    sources: ['git:example/repository'],
                    revisions: ['deadbeef'],
                    digests: [`sha256:${fixtureDigest}:${unsafePath}`, `sha256:${fixtureDigest}:${untrackedPath}`],
                    licenses: ['Apache-2.0'],
                    productSurfaces: ['source distribution'],
                    evidence: ['package.json'],
                    obligations: ['Preserve attribution.'],
                },
            ],
            snapshots: [],
            externalReferences: [],
            marks: [],
        };

        try {
            mkdirSync(dirname(join(root, trackedPath)), { recursive: true });
            mkdirSync(dirname(join(root, untrackedPath)), { recursive: true });
            writeFileSync(join(root, trackedPath), 'provider');
            writeFileSync(join(base, 'outside.txt'), 'outside');
            writeFileSync(join(root, untrackedPath), 'untracked');
            const forbiddenOpens: string[] = [];
            const readFile = {
                open: (path: string, flags: number) => {
                    if (path.endsWith(unsafePath) || path.endsWith(untrackedPath)) {
                        forbiddenOpens.push(path);
                    }
                    return openSync(path, flags);
                },
                read: (descriptor: number, buffer: Buffer, offset: number, length: number, position: number) =>
                    readSync(descriptor, buffer, offset, length, position),
            };

            const changed = loadRepositorySnapshot(root, value, [trackedPath], readFile);

            expect(forbiddenOpens).toEqual([]);
            expect(changed.fileDigests[unsafePath]).toBeUndefined();
            expect(changed.fileDigests[untrackedPath]).toBeUndefined();
            expect(validateReleaseInventory(value, changed)).toEqual(
                expect.arrayContaining([
                    `runtime: path-addressed digest path must be normalized and relative: ${unsafePath}`,
                    `runtime: path-addressed digest target is missing or untracked: ${untrackedPath}`,
                ])
            );
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('does not read a tracked scan-eligible path-addressed digest symlink outside the repository', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-symlink-digest-'));
        const root = join(base, 'repository');
        const trackedPath = 'provider.ts';
        const symlinkPath = 'public/legal/escaped.ts';
        const markSymlinkPath = 'public/legal/escaped.md';
        const outsidePath = join(base, 'outside.ts');
        const outsideMarkPath = join(base, 'outside.md');
        const value: ReleaseInventory = {
            schemaVersion: 1,
            surfaces: [
                {
                    id: 'runtime',
                    kind: 'source',
                    retention: 'keep',
                    owner: 'OS-01',
                    releaseModes: ['source'],
                    paths: [trackedPath, symlinkPath, markSymlinkPath],
                    sources: ['git:example/repository'],
                    revisions: ['deadbeef'],
                    digests: [`sha256:${fixtureDigest}:${symlinkPath}`],
                    licenses: ['Apache-2.0'],
                    productSurfaces: ['source distribution'],
                    evidence: ['package.json'],
                    obligations: ['Preserve attribution.'],
                },
            ],
            snapshots: [],
            externalReferences: [],
            marks: [{ value: 'UnsafeMark', paths: [markSymlinkPath] }],
        };

        try {
            mkdirSync(dirname(join(root, trackedPath)), { recursive: true });
            mkdirSync(dirname(join(root, symlinkPath)), { recursive: true });
            mkdirSync(dirname(join(root, markSymlinkPath)), { recursive: true });
            writeFileSync(join(root, trackedPath), 'provider');
            writeFileSync(outsidePath, "export const escaped = 'https://outside.example';\n");
            writeFileSync(outsideMarkPath, 'UnsafeMark');
            symlinkSync(outsidePath, join(root, symlinkPath));
            symlinkSync(outsideMarkPath, join(root, markSymlinkPath));
            const forbiddenReads: string[] = [];
            const readFile = {
                read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
                    const bytesRead = readSync(descriptor, buffer, offset, length, position);
                    const contents = buffer.subarray(offset, offset + bytesRead).toString('utf8');
                    if (contents.includes('outside') || contents.includes('UnsafeMark')) {
                        forbiddenReads.push(contents);
                    }
                    return bytesRead;
                },
            };

            const changed = loadRepositorySnapshot(root, value, [trackedPath, symlinkPath, markSymlinkPath], readFile);

            expect(forbiddenReads).toEqual([]);
            expect(changed.externalReferences).toEqual([]);
            expect(changed.fileDigests[symlinkPath]).toBe('missing');
            expect(changed.markPaths.UnsafeMark).toEqual([]);
            expect(validateReleaseInventory(value, changed)).toContain(
                `runtime: path-addressed digest target is missing or untracked: ${symlinkPath}`
            );
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('does not read a tracked path-addressed digest symlink contained by the repository', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-contained-symlink-digest-'));
        const root = join(base, 'repository');
        const symlinkPath = 'public/legal/contained.txt';
        const targetPath = join(root, 'public/legal/target.txt');
        const value = inventory();
        value.surfaces[0]!.digests = [`sha256:${fixtureDigest}:${symlinkPath}`];

        try {
            mkdirSync(dirname(targetPath), { recursive: true });
            writeFileSync(targetPath, 'contained legal bytes');
            symlinkSync(targetPath, join(root, symlinkPath));
            let opens = 0;
            let reads = 0;
            const readFile = {
                open: (path: string) => {
                    opens += 1;
                    return openSync(path, constants.O_RDONLY);
                },
                read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
                    reads += 1;
                    return readSync(descriptor, buffer, offset, length, position);
                },
            };

            const changed = loadRepositorySnapshot(root, value, [symlinkPath], readFile);

            expect(opens).toBe(0);
            expect(reads).toBe(0);
            expect(changed.fileDigests[symlinkPath]).toBe('missing');
            expect(validateReleaseInventory(value, changed)).toContain(
                `runtime: path-addressed digest target is missing or untracked: ${symlinkPath}`
            );
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('does not read a tracked path-addressed digest file with another hard link', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-hard-link-'));
        const root = join(base, 'repository');
        const path = 'public/legal/contained.txt';
        const filePath = join(root, path);
        const value = inventory();
        value.surfaces[0]!.digests = [`sha256:${fixtureDigest}:${path}`];

        try {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, 'contained legal bytes');
            linkSync(filePath, join(base, 'contained.alias.txt'));

            const changed = loadRepositorySnapshot(root, value, [path]);

            expect(changed.fileDigests[path]).toBe('missing');
            expect(validateReleaseInventory(value, changed)).toContain(
                `runtime: path-addressed digest target is missing or untracked: ${path}`
            );
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('rejects oversized path-addressed bytes before invoking a descriptor read', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-bounded-bytes-'));
        const root = join(base, 'repository');
        const path = 'public/legal/contained.txt';
        const filePath = join(root, path);
        const value = inventory();
        value.surfaces[0]!.digests = [`sha256:${fixtureDigest}:${path}`];
        let byteReads = 0;
        const reader = {
            fileByteLimit: 8,
            aggregateByteLimit: 32,
            read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
                byteReads += 1;
                return readSync(descriptor, buffer, offset, length, position);
            },
        };

        try {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, 'nine-byte');

            expect(() => loadRepositorySnapshot(root, value, [path], reader)).toThrow(
                'repository file byte limit exceeded'
            );
            expect(byteReads).toBe(0);
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('rejects oversized scanned text before invoking a descriptor read', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-bounded-text-'));
        const root = join(base, 'repository');
        const path = 'src/oversized.ts';
        const filePath = join(root, path);
        let textReads = 0;
        const reader = {
            fileByteLimit: 8,
            aggregateByteLimit: 32,
            read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
                textReads += 1;
                return readSync(descriptor, buffer, offset, length, position);
            },
        };

        try {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, "export const endpoint = 'https://attacker.example';\n");

            expect(() => loadRepositorySnapshot(root, { snapshots: [], marks: [] }, [path], reader)).toThrow(
                'repository file byte limit exceeded'
            );
            expect(textReads).toBe(0);
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('rejects an unexpected early EOF before accepting a repository descriptor snapshot', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-early-eof-'));
        const root = join(base, 'repository');
        const path = 'release/open-source-inventory.json';
        const filePath = join(root, path);
        const contents = JSON.stringify(inventory());
        let reads = 0;
        const reader: RepositorySnapshotFileReader = {
            read(descriptor, buffer, offset, length, position) {
                reads += 1;
                if (reads > 1) {
                    return 0;
                }
                return readSync(descriptor, buffer, offset, Math.min(length, contents.length - 4), position);
            },
        };

        try {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, contents);

            let failure: unknown;
            try {
                readReleaseInventory(root, reader);
            } catch (error) {
                failure = error;
            }

            expect(reads).toBe(2);
            expect(failure).toMatchObject({
                message: `release inventory cannot be read safely: ${filePath}`,
                cause: { message: 'unexpected early EOF while reading repository file descriptor' },
            });
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('enforces one aggregate descriptor-read budget across repository text and digest reads', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-aggregate-budget-'));
        const root = join(base, 'repository');
        const firstPath = 'src/first.ts';
        const secondPath = 'src/second.ts';
        const readDescriptors = new Set<number>();
        const reader = {
            fileByteLimit: 64,
            aggregateByteLimit: 40,
            read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
                const bytesRead = readSync(descriptor, buffer, offset, length, position);
                if (bytesRead > 0) {
                    readDescriptors.add(descriptor);
                }
                return bytesRead;
            },
        };

        try {
            mkdirSync(join(root, 'src'), { recursive: true });
            writeFileSync(join(root, firstPath), "export default 'https://a.io';\n");
            writeFileSync(join(root, secondPath), "export default 'https://b.io';\n");

            expect(() =>
                loadRepositorySnapshot(root, { snapshots: [], marks: [] }, [firstPath, secondPath], reader)
            ).toThrow('repository aggregate byte limit exceeded');
            expect(readDescriptors.size).toBe(1);
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('rejects an oversized release inventory before allocating its declared size', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-bounded-manifest-'));
        const root = join(base, 'repository');
        const inventoryPath = join(root, 'release/open-source-inventory.json');

        try {
            mkdirSync(dirname(inventoryPath), { recursive: true });
            writeFileSync(inventoryPath, '');
            truncateSync(inventoryPath, 8 * 1024 * 1024 + 1);

            expect(() => readReleaseInventory(root)).toThrow('release inventory exceeds the per-file byte limit');
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('does not read a tracked path-addressed digest file hard-linked while its descriptor opens', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-hard-link-race-'));
        const root = join(base, 'repository');
        const path = 'public/legal/contained.txt';
        const filePath = join(root, path);
        const aliasPath = join(base, 'contained.raced.txt');
        const value = inventory();
        value.surfaces[0]!.digests = [`sha256:${fixtureDigest}:${path}`];
        let reads = 0;

        try {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, 'contained legal bytes');
            const readFile = {
                open: (openPath: string, flags: number) => {
                    const descriptor = openSync(openPath, flags);
                    if (openPath === filePath) {
                        linkSync(filePath, aliasPath);
                    }
                    return descriptor;
                },
                noFollowFlag: () => constants.O_NOFOLLOW,
                read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
                    reads += 1;
                    return readSync(descriptor, buffer, offset, length, position);
                },
            };

            const changed = loadRepositorySnapshot(root, value, [path], readFile);

            expect(changed.fileDigests[path]).toBe('missing');
            expect(reads).toBe(0);
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('rejects a contained symlink substituted between the precheck and open', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-symlink-swap-'));
        const root = join(base, 'repository');
        const path = 'public/legal/contained.txt';
        const filePath = join(root, path);
        const targetPath = join(root, 'public/legal/target.txt');
        const value = inventory();
        value.surfaces[0]!.digests = [`sha256:${fixtureDigest}:${path}`];
        let reads = 0;
        const attemptedFlags: number[] = [];
        let successfulReplacementOpens = 0;

        try {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, 'contained legal bytes');
            writeFileSync(targetPath, 'contained legal bytes');
            const readFile = {
                open: (openPath: string, flags: number) => {
                    rmSync(filePath);
                    symlinkSync(targetPath, filePath);
                    attemptedFlags.push(flags);
                    const descriptor = openSync(openPath, flags);
                    successfulReplacementOpens += 1;
                    return descriptor;
                },
                noFollowFlag: () => constants.O_NOFOLLOW,
                read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
                    reads += 1;
                    return readSync(descriptor, buffer, offset, length, position);
                },
            };

            const changed = loadRepositorySnapshot(root, value, [path], readFile);

            expect(changed.fileDigests[path]).toBe('missing');
            expect(reads).toBe(0);
            expect(attemptedFlags).toHaveLength(1);
            expect(attemptedFlags[0]! & constants.O_NOFOLLOW).not.toBe(0);
            expect(successfulReplacementOpens).toBe(0);
            expect(validateReleaseInventory(value, changed)).toContain(
                `runtime: path-addressed digest target is missing or untracked: ${path}`
            );
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('does not admit scanned text when the path swaps to an outside symlink during read', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-text-swap-'));
        const root = join(base, 'repository');
        const path = 'public/legal/safe.ts';
        const filePath = join(root, path);
        const outsidePath = join(base, 'outside.ts');
        const insideReference = 'https://inside.example.test/safe';

        try {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, `export const safe = '${insideReference}';\n`);
            writeFileSync(outsidePath, "export const escaped = 'https://outside.net';\n");
            let swapped = false;
            const readFile = {
                read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
                    if (!swapped) {
                        rmSync(filePath);
                        symlinkSync(outsidePath, filePath);
                        swapped = true;
                    }
                    return readSync(descriptor, buffer, offset, length, position);
                },
            };

            const changed = loadRepositorySnapshot(root, { snapshots: [], marks: [] }, [path], readFile);

            expect(swapped).toBe(true);
            expect(changed.externalReferences).not.toContain(insideReference);
            expect(changed.externalReferences).toEqual([]);
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('does not admit path-addressed digest bytes when the path swaps to an outside symlink during read', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-byte-swap-'));
        const root = join(base, 'repository');
        const path = 'public/legal/safe.txt';
        const filePath = join(root, path);
        const outsidePath = join(base, 'outside.txt');
        const safeContents = 'inside legal bytes';
        const outsideContents = 'outside legal bytes';
        const value = inventory();
        value.surfaces[0]!.digests = [`sha256:${sha256(safeContents)}:${path}`];

        try {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, safeContents);
            writeFileSync(outsidePath, outsideContents);
            let swapped = false;
            const readFile = {
                read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
                    if (!swapped) {
                        rmSync(filePath);
                        symlinkSync(outsidePath, filePath);
                        swapped = true;
                    }
                    return readSync(descriptor, buffer, offset, length, position);
                },
            };

            const changed = loadRepositorySnapshot(root, value, [path], readFile);

            expect(changed.fileDigests[path]).toBe('missing');
            expect(validateReleaseInventory(value, changed)).toContain(
                `runtime: path-addressed digest target is missing or untracked: ${path}`
            );
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('does not admit path-addressed digest bytes when the file gains a hard link during read', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-byte-read-link-'));
        const root = join(base, 'repository');
        const path = 'public/legal/safe.txt';
        const filePath = join(root, path);
        const aliasPath = join(base, 'safe-read.alias.txt');
        const safeContents = 'inside legal bytes';
        const value = inventory();
        value.surfaces[0]!.digests = [`sha256:${sha256(safeContents)}:${path}`];
        let linked = false;

        try {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, safeContents);
            const readFile = {
                read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
                    if (!linked) {
                        linkSync(filePath, aliasPath);
                        linked = true;
                    }
                    return readSync(descriptor, buffer, offset, length, position);
                },
            };

            const changed = loadRepositorySnapshot(root, value, [path], readFile);

            expect(changed.fileDigests[path]).toBe('missing');
            expect(linked).toBe(true);
            expect(validateReleaseInventory(value, changed)).toContain(
                `runtime: path-addressed digest target is missing or untracked: ${path}`
            );
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('does not admit scanned text when the file gains a hard link during read', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-text-read-link-'));
        const root = join(base, 'repository');
        const path = 'public/legal/safe.ts';
        const filePath = join(root, path);
        const aliasPath = join(base, 'safe-read.alias.ts');
        let linked = false;

        try {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, "export const source = 'https://inside.test';\n");
            const readFile = {
                read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number) {
                    if (!linked) {
                        linkSync(filePath, aliasPath);
                        linked = true;
                    }
                    return readSync(descriptor, buffer, offset, length, position);
                },
            };

            const changed = loadRepositorySnapshot(root, { snapshots: [], marks: [] }, [path], readFile);

            expect(changed.externalReferences).toEqual([]);
            expect(linked).toBe(true);
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('does not read non-canonical or untracked snapshot paths', () => {
        const base = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-unsafe-snapshots-'));
        const root = join(base, 'repository');
        const trackedPath = 'provider.ts';
        const unsafePath = '../outside.txt';
        const untrackedPath = 'public/legal/untracked.txt';
        const value = inventory();
        value.surfaces = [];
        value.snapshots = [
            { path: unsafePath, sha256: fixtureDigest },
            { path: untrackedPath, sha256: fixtureDigest },
        ];

        try {
            mkdirSync(dirname(join(root, untrackedPath)), { recursive: true });
            writeFileSync(join(root, trackedPath), 'provider');
            writeFileSync(join(base, 'outside.txt'), 'outside');
            writeFileSync(join(root, untrackedPath), 'untracked');
            const forbiddenOpens: string[] = [];
            const readFile = {
                open: (path: string, flags: number) => {
                    if (path.endsWith(unsafePath) || path.endsWith(untrackedPath)) {
                        forbiddenOpens.push(path);
                    }
                    return openSync(path, flags);
                },
                read: (descriptor: number, buffer: Buffer, offset: number, length: number, position: number) =>
                    readSync(descriptor, buffer, offset, length, position),
            };

            const changed = loadRepositorySnapshot(root, value, [trackedPath], readFile);

            expect(forbiddenOpens).toEqual([]);
            expect(changed.fileDigests[unsafePath]).toBeUndefined();
            expect(changed.fileDigests[untrackedPath]).toBeUndefined();
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    it('does not open an untracked required snapshot path', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-required-snapshot-'));
        const trackedPath = 'provider.ts';
        const requiredPath = REQUIRED_SNAPSHOT_PATHS[0];

        try {
            writeFileSync(join(root, trackedPath), 'provider');
            writeFileSync(join(root, requiredPath), 'untracked required snapshot');
            let opens = 0;
            const readFile = {
                open: (path: string) => {
                    opens += 1;
                    return openSync(path, constants.O_RDONLY);
                },
                read: (descriptor: number, buffer: Buffer, offset: number, length: number, position: number) =>
                    readSync(descriptor, buffer, offset, length, position),
            };

            const changed = loadRepositorySnapshot(root, { snapshots: [], marks: [] }, [trackedPath], readFile);

            expect(opens).toBe(0);
            expect(changed.fileDigests[requiredPath]).toBeUndefined();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('does not open or read path-addressed digests without no-follow support', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-no-follow-'));
        const path = 'public/legal/safe.txt';
        const value = inventory();
        value.surfaces[0]!.digests = [`sha256:${fixtureDigest}:${path}`];

        try {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), 'safe legal bytes');
            let opens = 0;
            let reads = 0;
            const readFile = {
                noFollowFlag: () => undefined,
                open: (openPath: string) => {
                    opens += 1;
                    return openSync(openPath, constants.O_RDONLY);
                },
                read: (descriptor: number, buffer: Buffer, offset: number, length: number, position: number) => {
                    reads += 1;
                    return readSync(descriptor, buffer, offset, length, position);
                },
            };

            const changed = loadRepositorySnapshot(root, value, [path], readFile);

            expect(opens).toBe(0);
            expect(reads).toBe(0);
            expect(changed.fileDigests[path]).toBe('missing');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('should reject a path-addressed digest whose tracked file was deleted', () => {
        const path = 'public/legal/Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.dlpack.txt';
        const trackedPath = 'src/provider.ts';
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-loader-'));
        const value: ReleaseInventory = {
            schemaVersion: 1,
            surfaces: [
                {
                    id: 'runtime',
                    kind: 'source',
                    retention: 'keep',
                    owner: 'OS-01',
                    releaseModes: ['source'],
                    paths: [trackedPath],
                    sources: ['git:example/repository'],
                    revisions: ['deadbeef'],
                    digests: [`sha256:${fixtureDigest}:${path}`],
                    licenses: ['Apache-2.0'],
                    productSurfaces: ['source distribution'],
                    evidence: ['package.json'],
                    obligations: ['Preserve attribution.'],
                },
            ],
            snapshots: [],
            externalReferences: [],
            marks: [],
        };

        try {
            mkdirSync(dirname(join(root, trackedPath)), { recursive: true });
            writeFileSync(join(root, trackedPath), 'provider');
            const changed = loadRepositorySnapshot(root, value, [trackedPath, path]);

            expect(changed.fileDigests[path]).toBe('missing');
            expect(validateReleaseInventory(value, changed)).toContain(
                `runtime: path-addressed digest target is missing or untracked: ${path}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('records the actual SHA-256 for an existing path-addressed digest target introduced by a surface digest', () => {
        const path = 'public/legal/Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.dlpack.txt';
        const trackedPath = 'src/provider.ts';
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-loader-'));
        const value: ReleaseInventory = {
            schemaVersion: 1,
            surfaces: [
                {
                    id: 'runtime',
                    kind: 'source',
                    retention: 'keep',
                    owner: 'OS-01',
                    releaseModes: ['source'],
                    paths: [trackedPath],
                    sources: ['git:example/repository'],
                    revisions: ['deadbeef'],
                    digests: [`sha256:${fixtureDigest}:${path}`],
                    licenses: ['Apache-2.0'],
                    productSurfaces: ['source distribution'],
                    evidence: ['package.json'],
                    obligations: ['Preserve attribution.'],
                },
            ],
            snapshots: [],
            externalReferences: [],
            marks: [],
        };

        try {
            mkdirSync(dirname(join(root, trackedPath)), { recursive: true });
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, trackedPath), 'provider');
            writeFileSync(join(root, path), 'dlpack license');
            const changed = loadRepositorySnapshot(root, value, [trackedPath, path]);

            expect(changed.fileDigests[path]).toBe(sha256('dlpack license'));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('should ignore semantic and remote artifact digest labels', () => {
        const value = inventory();
        value.surfaces[0]!.digests = [
            `sha256:${fixtureDigest}:5566554:public/icon.png`,
            `sha256:${fixtureDigest}:bytes:5566554:https://models.example/public/icon.png`,
            `sha256:${fixtureDigest}:@runtime-license`,
        ];
        const changed = snapshot();
        changed.fileDigests['public/icon.png'] = 'b'.repeat(64);

        expect(validateReleaseInventory(value, changed)).toEqual([]);
    });

    it('should ignore git-addressed digest labels', () => {
        const value = inventory();
        value.surfaces[0]!.digests = [
            `sha256:${fixtureDigest}:git:github.com/sourcebox/mi-plaits-dsp-rs@6d3f7a5b84b25ec45d66c9f6be7109474690d795:LICENSE.txt`,
        ];

        expect(validateReleaseInventory(value, snapshot())).toEqual([]);
    });

    it('composes the admitted DDSP model contract into live release inventory validation', { timeout: 20_000 }, () => {
        expect(checkReleaseInventory(process.cwd()).validatedSurfaceIds).toContain('ddsp-models');
    });

    it('binds admitted DDSP writes, rendering, exact artifacts, and reversal obligations', () => {
        const contract = ddspModelsReleaseInventoryContract(repositoryRoot);

        expect(contract.retention).toBe('keep-with-obligations');
        expect(contract.paths).toEqual(DDSP_MODEL_PATHS);
        expect(contract.paths).not.toContain('scripts/checkReleaseInventory.ts');
        expect(contract.paths).toEqual(
            expect.arrayContaining([
                'electron/protocol.ts',
                'src/modules/BrowserAi/repositories/stageDdspInstrumentGeneration.ts',
                'src/modules/BrowserAi/repositories/checkDdspInstrumentReady.ts',
                'src/modules/BrowserAi/repositories/cleanupUnpublishedDdspGeneration.ts',
                'src/modules/BrowserAi/repositories/ddspGenerationStorageSupport.ts',
                'src/modules/BrowserAi/repositories/modelStorageWorkerBridge.ts',
                'src/modules/BrowserAi/repositories/withDdspInstrumentLock.ts',
                'src/modules/BrowserAi/workers/modelStorageWorker.ts',
                'src/modules/BrowserAi/workers/modelStorageWorkerRuntime.ts',
                'src/modules/BrowserAi/repositories/removeDdspInstrumentGenerations.ts',
                'src/modules/BrowserAi/useCases/removeDdspInstrument.ts',
                'src/modules/BrowserAi/useCases/downloadModel.ts',
                'src/modules/BrowserAi/useCases/removeModel.ts',
                'src/modules/BrowserAi/useCases/renderDdspInstrument.ts',
            ])
        );
        for (const path of ddspModelEnforcementPaths) {
            expect(contract.digests?.some((digest) => digest.endsWith(`:${path}`))).toBe(true);
        }
        expect(contract.digests?.filter((digest) => digest.includes(':bytes:'))).toHaveLength(12);
        expect(contract.licenses).toEqual(['unverified:exact-GCS-checkpoint-artifacts']);
        expect(contract.obligations).toEqual(
            expect.arrayContaining([
                expect.stringContaining('checkpoint license explicitly unverified'),
                expect.stringContaining('MODEL_RELEASE_ADMISSION.ddsp to false'),
                expect.stringContaining('exact Magenta DDSP source from electron/protocol.ts connect-src'),
                expect.stringContaining('remove its release inventory egress assignment'),
            ])
        );
    });

    it.each([DDSP_ADMISSION_DECISION_PATH, 'electron/protocol.ts', 'public/legal/THIRD-PARTY-NOTICES.md'])(
        'rejects admitted DDSP provenance drift in %s',
        (changedPath) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-ddsp-model-admission-'));
            const manifestPath = 'src/modules/BrowserAi/models/DdspArtifactManifest.ts';
            const manifest = `baseline:${manifestPath}`;
            writeDdspModelContractFixture(root, manifest);

            try {
                const admitted = ddspModelsReleaseInventoryContract(root);
                expect(() => assertDdspModelsReleaseInventory(root, admitted)).not.toThrow();

                writeFileSync(join(root, changedPath), `changed:${changedPath}`);
                expect(() => assertDdspModelsReleaseInventory(root, admitted)).toThrow(
                    changedPath === DDSP_ADMISSION_DECISION_PATH
                        ? 'ADR 0035 does not admit the current DDSP artifact manifest'
                        : 'DDSP models release inventory digests does not match provenance'
                );
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it.each([...DDSP_TFJS_APPLICATION_RUNTIME_PATHS])(
        'rejects drift in admitted DDSP TF.js runtime source %s',
        (changedPath) => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-ddsp-tfjs-runtime-'));
            for (const path of DDSP_TFJS_RUNTIME_PATHS) {
                if (!path.startsWith('public/legal/') && !ddspTfjsApplicationRuntimePathSet.has(path)) {
                    continue;
                }
                mkdirSync(dirname(join(root, path)), { recursive: true });
                writeFileSync(join(root, path), `baseline:${path}`);
            }

            try {
                const before = ddspTfjsRuntimeReleaseInventoryContract(root);
                writeFileSync(join(root, changedPath), `changed runtime:${changedPath}`);

                expect(ddspTfjsRuntimeReleaseInventoryContract(root).digests).not.toEqual(before.digests);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        }
    );

    it.each([
        'src/modules/BrowserAi/repositories/withDdspInstrumentLock.ts',
        'src/modules/BrowserAi/workers/modelStorageWorker.ts',
        'src/modules/BrowserAi/workers/modelStorageWorkerRuntime.ts',
        'src/infra/release/modelReleaseAdmission.ts',
        'src/modules/BrowserAi/useCases/renderDdspInstrument.ts',
        'src/modules/BrowserAi/useCases/removeDdspInstrument.ts',
        'src/modules/BrowserAi/useCases/downloadModel.ts',
        'src/modules/BrowserAi/useCases/removeModel.ts',
    ])('rejects drift in admitted DDSP enforcement %s', (changedPath) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-ddsp-enforcement-'));
        writeDdspModelContractFixture(root, 'admitted manifest');

        try {
            const admitted = ddspModelsReleaseInventoryContract(root);
            writeFileSync(join(root, changedPath), `changed enforcement:${changedPath}`);

            expect(() => assertDdspModelsReleaseInventory(root, admitted)).toThrow(
                'DDSP models release inventory digests does not match provenance'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a regenerated DDSP inventory when the manifest changes without a new admission decision', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-ddsp-manifest-anchor-'));
        const manifestPath = 'src/modules/BrowserAi/models/DdspArtifactManifest.ts';
        const manifest = 'admitted manifest';
        writeDdspModelContractFixture(root, manifest);

        try {
            const admitted = ddspModelsReleaseInventoryContract(root);
            const changedManifest = 'changed manifest and artifact identities';
            writeFileSync(join(root, manifestPath), changedManifest);
            const regenerated = {
                ...admitted,
                digests: admitted.digests?.map((digest) =>
                    digest.endsWith(`:${manifestPath}`) ? `sha256:${sha256(changedManifest)}:${manifestPath}` : digest
                ),
            };

            expect(() => assertDdspModelsReleaseInventory(root, regenerated)).toThrow(
                'ADR 0035 does not admit the current DDSP artifact manifest'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('keeps the public DDSP notice truthful about active downloads and the unverified checkpoint license', () => {
        const notice = readFileSync(join(repositoryRoot, 'public/legal/THIRD-PARTY-NOTICES.md'), 'utf8');

        expect(notice).not.toContain('release-withheld DDSP worker');
        expect(notice).not.toContain('product admission gate remains closed');
        expect(notice).toContain('checkpoint license remains unverified');
        expect(notice).toContain('does not bundle or redistribute');
    });

    it('binds the exact DDSP TF.js dependency and legal closure', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-ddsp-tfjs-provenance-'));
        for (const path of DDSP_TFJS_RUNTIME_PATHS) {
            if (!path.startsWith('public/legal/') && !ddspTfjsApplicationRuntimePathSet.has(path)) {
                continue;
            }
            mkdirSync(join(root, path, '..'), { recursive: true });
            writeFileSync(join(root, path), path);
        }

        try {
            const before = ddspTfjsRuntimeReleaseInventoryContract(root);
            expect(before.kind).toBe('runtime-library');
            expect(before.paths).toEqual(DDSP_TFJS_RUNTIME_PATHS);
            expect(before.revisions).toContain('@tensorflow/tfjs-backend-webgpu 4.22.0');
            expect(before.revisions).toContain('@tensorflow/tfjs-backend-cpu 4.22.0 shared helpers only');
            expect(before.licenses).toEqual([
                'Apache-2.0:TensorFlow.js',
                'Apache-2.0:long',
                'Apache-2.0:Magenta.js-Roll-adaptation',
                'MIT:seedrandom-and-Alea',
            ]);

            writeFileSync(join(root, 'public/legal/TensorFlow.js-NOTICE.txt'), 'changed');
            expect(ddspTfjsRuntimeReleaseInventoryContract(root).digests).not.toEqual(before.digests);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds Grand Boule source bytes to its inventory digest', { timeout: 20_000 }, () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-provenance-'));
        writeGrandBouleReleaseFixture(root);
        const grandBoule = join(root, 'crates/daw-dsp/src/grand_boule');

        try {
            const before = grandBouleReleaseInventoryContract(root);
            expect(before.retention).toBe('keep');
            expect(before.releaseModes).toEqual(['source', 'web', 'desktop']);
            expect(before.paths).toEqual(GRAND_BOULE_RELEASE_REGISTRY.boundaries.flatMap(({ paths }) => [...paths]));
            expect(before.paths).toContain('src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts');
            expect(before.paths).toContain('src/modules/Arrangement/useCases/device/setDeviceState.ts');
            expect(before.paths).toContain('src/infra/release/deviceReleaseAdmission.ts');
            expect(before.paths).toContain('src/modules/AudioEngine/worklets/grandBoule*.ts');
            expect(before.paths).not.toContain('src/modules/AudioEngine/worklets/**');
            expect(before.productSurfaces).toEqual(['Grand Boule source, browser WASM, and desktop runtime']);
            expect(before.digests).toHaveLength(GRAND_BOULE_RELEASE_REGISTRY.boundaries.length);
            expect(before.digests).toEqual(
                GRAND_BOULE_RELEASE_REGISTRY.boundaries.map(({ digestLabel }) =>
                    expect.stringMatching(new RegExp(`^tracked-set-sha256:[0-9a-f]{64}:${digestLabel}$`))
                )
            );
            const projectStateDigest = findDigestByLabel(before.digests, 'grand-boule-project-state');
            expect(projectStateDigest).toBe(independentGrandBouleProjectStateDigest(root));

            writeFileSync(join(grandBoule, 'untracked.rs'), 'untracked source');
            expect(grandBouleReleaseInventoryContract(root).digests).toEqual(before.digests);

            const enginePath = join(grandBoule, 'engine.rs');
            const originalEngine = readFileSync(enginePath, 'utf8');
            writeFileSync(enginePath, 'changed source');
            expect(grandBouleReleaseInventoryContract(root).digests).not.toEqual(before.digests);
            writeFileSync(enginePath, originalEngine);

            const providerSymlinkPath = join(root, 'src/modules/GrandBoule/CLAUDE.md');
            rmSync(providerSymlinkPath);
            symlinkSync('OTHER.md', providerSymlinkPath);
            expect(() => grandBouleReleaseInventoryContract(root)).toThrow(
                'Grand Boule provider-policy symlink checkout target is not AGENTS.md'
            );
            rmSync(providerSymlinkPath);
            symlinkSync('AGENTS.md', providerSymlinkPath);
            expect(
                findDigestByLabel(grandBouleReleaseInventoryContract(root).digests, 'grand-boule-project-state')
            ).toBe(projectStateDigest);

            writeFileSync(
                join(root, 'src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts'),
                'changed descriptor'
            );
            expect(grandBouleReleaseInventoryContract(root).digests).not.toEqual(before.digests);

            const representatives = [
                'crates/daw-dsp/src/grand_boule/engine.rs',
                '.agents/decisions/0036-readmit-grand-boule.md',
                'src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts',
                'src/infra/release/deviceReleaseAdmission.ts',
                'src/modules/AudioEngine/engine/GrandBouleNode.ts',
                'src/modules/GrandBoule/models/GrandBouleConfig.ts',
                'src/modules/Command/useCases/versionedCommandArgumentKeys.ts',
                'src/modules/Arrangement/useCases/index.ts',
                'src/modules/Arrangement/useCases/device/setDeviceState.ts',
                'src/app/prepareOfflineDeviceSetup.ts',
                'crates/daw-dsp/benches/quantum.rs',
                'crates/daw-dsp/benches/wasm/deviceRecipes.js',
                'crates/daw-dsp/benches/wasm/quantumCostProcessor.js',
                'crates/daw-dsp/benches/wasm/run.mjs',
                'crates/daw-dsp/benches/wasm/renderTable.mjs',
                'crates/daw-dsp/benches/wasm/renderTable.d.mts',
                'crates/daw-dsp/benches/quantum-cost-table.json',
                'crates/daw-dsp/benches/quantum-cost-table.md',
                'crates/daw-dsp/tests/quantum_bench_census.rs',
                'scripts/checkReleaseInventory.ts',
            ];
            writeGrandBouleReleaseFixture(root);
            const baseline = grandBouleReleaseInventoryContract(root).digests;
            for (const [index, path] of representatives.entries()) {
                const absolute = join(root, path);
                const original = readFileSync(absolute, 'utf8');
                writeFileSync(absolute, `${original}\nmutation-${index}`);
                const changed = grandBouleReleaseInventoryContract(root).digests;
                const boundaryIndex = GRAND_BOULE_RELEASE_REGISTRY.boundaries.findIndex(({ gitPathspecs }) =>
                    gitPathspecs.some((pathspec) => {
                        const normalized = pathspec.replace(/^:\(glob\)/u, '').replace(/\/\*\*$/u, '');
                        return path === normalized || path.startsWith(`${normalized}/`);
                    })
                );
                expect(
                    changed.flatMap((digest, changedIndex) => (digest === baseline[changedIndex] ? [] : [changedIndex]))
                ).toEqual([boundaryIndex]);
                writeFileSync(absolute, original);
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('requires canonical committed Grand Boule provider-policy symlinks before excluding them', () => {
        const projectState = GRAND_BOULE_RELEASE_REGISTRY.boundaries.find(
            ({ digestLabel }) => digestLabel === 'grand-boule-project-state'
        );
        expect(projectState?.excludedPaths).toEqual(GRAND_BOULE_PROVIDER_POLICY_SYMLINK_PATHS);
        expect(projectState?.gitPathspecs).toEqual(
            expect.arrayContaining(GRAND_BOULE_PROVIDER_POLICY_SYMLINK_PATHS.map((path) => `:(exclude)${path}`))
        );

        const canonicalBase = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-policy-symlinks-canonical-'));
        const canonicalRoot = join(canonicalBase, 'repository');
        writeGrandBouleReleaseFixture(canonicalRoot);
        try {
            expect(() => grandBouleReleaseInventoryContract(canonicalRoot)).not.toThrow();
        } finally {
            rmSync(canonicalBase, { recursive: true, force: true });
        }

        const unmergedBase = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-policy-symlinks-unmerged-'));
        const unmergedRoot = join(unmergedBase, 'repository');
        writeGrandBouleReleaseFixture(unmergedRoot);
        try {
            const path = GRAND_BOULE_PROVIDER_POLICY_SYMLINK_PATHS[0];
            const [mode, object] = execFileSync('git', ['ls-files', '--stage', '--', path], {
                cwd: unmergedRoot,
                encoding: 'utf8',
            })
                .trim()
                .split(/\s+/u);
            expect(mode).toBe('120000');
            expect(object).toHaveLength(40);
            const indexInfo = [1, 2, 3].map((stage) => `${mode} ${object} ${stage}\t${path}`).join('\n');
            execFileSync('git', ['update-index', '--index-info'], {
                cwd: unmergedRoot,
                input: `${indexInfo}\n`,
            });

            expect(() => grandBouleReleaseInventoryContract(unmergedRoot)).toThrow(
                `Grand Boule provider-policy symlink index must contain exactly one stage-0 entry: ${path}`
            );
        } finally {
            rmSync(unmergedBase, { recursive: true, force: true });
        }
        const checkoutBase = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-policy-symlinks-checkout-'));
        const checkoutRoot = join(checkoutBase, 'repository');
        writeGrandBouleReleaseFixture(checkoutRoot);
        try {
            const checkoutPath = join(checkoutRoot, GRAND_BOULE_PROVIDER_POLICY_SYMLINK_PATHS[0]);
            rmSync(checkoutPath);
            symlinkSync('OTHER.md', checkoutPath);
            expect(() => grandBouleReleaseInventoryContract(checkoutRoot)).toThrow(
                'Grand Boule provider-policy symlink checkout target is not AGENTS.md'
            );
        } finally {
            rmSync(checkoutBase, { recursive: true, force: true });
        }

        const mutations = [
            {
                name: 'missing entry',
                error: 'Grand Boule provider-policy symlink is not tracked',
                mutate: (root: string, path: string, _outside: string) => {
                    rmSync(join(root, path));
                    execFileSync('git', ['rm', '--cached', '--', path], { cwd: root });
                },
            },
            {
                name: 'regular-file substitution',
                error: 'Grand Boule provider-policy symlink is not tracked as a symlink',
                mutate: (root: string, path: string, _outside: string) => {
                    rmSync(join(root, path));
                    writeFileSync(join(root, path), 'not a symlink');
                    execFileSync('git', ['add', '--', path], { cwd: root });
                },
            },
            {
                name: 'wrong relative target',
                error: 'Grand Boule provider-policy symlink commit target is not AGENTS.md',
                mutate: (root: string, path: string, _outside: string) => {
                    rmSync(join(root, path));
                    symlinkSync('OTHER.md', join(root, path));
                    execFileSync('git', ['add', '--', path], { cwd: root });
                },
            },
            {
                name: 'absolute outside target',
                error: 'Grand Boule provider-policy symlink commit target is not AGENTS.md',
                mutate: (root: string, path: string, outside: string) => {
                    rmSync(join(root, path));
                    symlinkSync(outside, join(root, path));
                    execFileSync('git', ['add', '--', path], { cwd: root });
                },
            },
        ] as const;

        for (const [index, mutation] of mutations.entries()) {
            const base = mkdtempSync(join(tmpdir(), `sourdaw-grand-boule-policy-symlinks-${index}-`));
            const root = join(base, 'repository');
            const outside = join(base, 'outside.md');
            writeGrandBouleReleaseFixture(root);
            writeFileSync(outside, 'provider policy');
            try {
                const path =
                    GRAND_BOULE_PROVIDER_POLICY_SYMLINK_PATHS[
                        index % GRAND_BOULE_PROVIDER_POLICY_SYMLINK_PATHS.length
                    ]!;
                mutation.mutate(root, path, outside);
                execFileSync(
                    'git',
                    [
                        '-c',
                        'user.name=Fixture',
                        '-c',
                        'user.email=fixture@example.test',
                        'commit',
                        '-qm',
                        mutation.name,
                    ],
                    { cwd: root }
                );
                expect(() => grandBouleReleaseInventoryContract(root)).toThrow(mutation.error);
            } finally {
                rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            }
        }

        const unexpectedBase = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-policy-symlinks-unexpected-'));
        const unexpectedRoot = join(unexpectedBase, 'repository');
        const outside = join(unexpectedBase, 'outside.md');
        writeGrandBouleReleaseFixture(unexpectedRoot);
        writeFileSync(outside, 'provider policy');
        try {
            const unexpected = 'src/modules/GrandBoule/unexpected-policy.md';
            symlinkSync(outside, join(unexpectedRoot, unexpected));
            execFileSync('git', ['add', '--', unexpected], { cwd: unexpectedRoot });
            expect(() => grandBouleReleaseInventoryContract(unexpectedRoot)).toThrow(
                `Grand Boule release source is unsafe: ${unexpected}`
            );
        } finally {
            rmSync(unexpectedBase, { recursive: true, force: true });
        }
    });

    it('rejects a Grand Boule tracked-file swap before either reader consumes it', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-tracked-swap-'));
        writeGrandBouleReleaseFixture(root);
        const swappedPath = join(root, 'crates/daw-dsp/src/grand_boule/engine.rs');
        const outside = join(root, 'outside.rs');
        writeFileSync(outside, 'outside source');
        let swapped = false;
        let readsAfterSwap = 0;
        const attemptedFlags: number[] = [];
        let successfulReplacementOpens = 0;
        const reader: RepositorySnapshotFileReader = {
            open(path, flags) {
                if (path === swappedPath) {
                    rmSync(swappedPath);
                    symlinkSync(outside, swappedPath);
                    swapped = true;
                    attemptedFlags.push(flags);
                }
                const descriptor = openSync(path, flags);
                if (path === swappedPath) {
                    successfulReplacementOpens += 1;
                }
                return descriptor;
            },
            noFollowFlag: () => constants.O_NOFOLLOW,
            read(descriptor, buffer, offset, length, position) {
                if (swapped) {
                    readsAfterSwap += 1;
                }
                return readSync(descriptor, buffer, offset, length, position);
            },
        };

        try {
            expect(() => grandBouleReleaseInventoryContract(root, reader)).toThrow(
                'Grand Boule release source is unsafe: crates/daw-dsp/src/grand_boule/engine.rs'
            );
            expect(readsAfterSwap).toBe(0);
            expect(attemptedFlags).toHaveLength(1);
            expect(attemptedFlags[0]! & constants.O_NOFOLLOW).not.toBe(0);
            expect(successfulReplacementOpens).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
    it('rejects every tracked Rust file without an admission basis', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-source-gap-'));
        try {
            writeGrandBouleReleaseFixture(root);
            const unsupported = join(root, 'crates/daw-dsp/src/grand_boule/unsupported.rs');
            writeFileSync(unsupported, 'project source');
            execFileSync('git', ['add', 'crates/daw-dsp/src/grand_boule/unsupported.rs'], { cwd: root });
            expect(() => assertGrandBouleRustSourceAdmission(root)).toThrow('unsupported attribution gap');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds the measured row to exact voice proof, source bytes, revision, and Markdown', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-measurement-'));
        try {
            const { jsonPath } = writeGrandBouleMeasurementFixture(root);
            expect(() => assertGrandBouleMeasurementAdmission(root)).not.toThrow();

            const measuredSourcePath = join(root, 'crates/daw-dsp/benches/quantum.rs');
            const originalSource = readFileSync(measuredSourcePath, 'utf8');
            writeFileSync(measuredSourcePath, `${originalSource}\ncurrent source mutation`);
            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow('source digest drifted');
            writeFileSync(measuredSourcePath, originalSource);

            const original = readFileSync(jsonPath, 'utf8');
            const unresolvedRevision = 'f'.repeat(40);
            const unresolved = JSON.parse(original) as {
                sourceRevision: string;
                machine: { gitSha: string };
            };
            unresolved.sourceRevision = unresolvedRevision;
            unresolved.machine.gitSha = unresolvedRevision;
            writeFileSync(jsonPath, JSON.stringify(unresolved));
            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow(
                `source revision ${unresolvedRevision} cannot provide crates/daw-dsp/benches/quantum.rs`
            );

            const data = JSON.parse(original) as {
                sourceDigests: Record<string, string>;
                rows: Array<{ warmVerify: { detail: string } }>;
            };
            data.rows[0]!.warmVerify.detail = 'active_voices() = 63, expected 64';
            writeFileSync(jsonPath, JSON.stringify(data));
            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow('exactly 64 active voices');

            const changed = JSON.parse(original) as {
                sourceDigests: Record<string, string>;
            };
            changed.sourceDigests['crates/daw-dsp/benches/quantum.rs'] = '0'.repeat(64);
            writeFileSync(jsonPath, JSON.stringify(changed));
            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow(
                'recorded digest does not match source revision'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('fetches an absent full measurement revision from a shallow origin clone', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-measurement-source-'));
        let clone: string | undefined;
        let remote: string | undefined;
        try {
            const fixture = writeShallowGrandBouleMeasurementFixture(root);
            clone = fixture.clone;
            remote = fixture.remote;
            expect(() =>
                execFileSync('git', ['cat-file', '-e', `${fixture.revision}^{commit}`], { cwd: clone, stdio: 'ignore' })
            ).toThrow();

            expect(() => assertGrandBouleMeasurementAdmission(clone!)).not.toThrow();
            expect(() =>
                execFileSync('git', ['cat-file', '-e', `${fixture.revision}^{commit}`], { cwd: clone, stdio: 'ignore' })
            ).not.toThrow();

            const data = JSON.parse(readFileSync(fixture.jsonPath, 'utf8')) as {
                sourceRevision: string;
                machine: { gitSha: string };
            };
            const abbreviatedRevision = fixture.revision.slice(0, 12);
            data.sourceRevision = abbreviatedRevision;
            data.machine.gitSha = abbreviatedRevision;
            writeFileSync(fixture.jsonPath, JSON.stringify(data));
            expect(() => assertGrandBouleMeasurementAdmission(clone!)).toThrow(
                'Grand Boule measurement source revision must be a full hexadecimal commit ID'
            );
        } finally {
            if (clone !== undefined) {
                rmSync(clone, { recursive: true, force: true });
            }
            if (remote !== undefined) {
                rmSync(remote, { recursive: true, force: true });
            }
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a full tree object ID even when it provides every measured source path', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-measurement-tree-'));
        try {
            const { jsonPath, revision } = writeGrandBouleMeasurementFixture(root);
            const treeRevision = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
                cwd: root,
                encoding: 'utf8',
            }).trim();
            const measuredSourcePath = 'crates/daw-dsp/benches/quantum.rs';
            expect(treeRevision).toMatch(/^[0-9a-f]{40}$/u);
            expect(() =>
                execFileSync('git', ['show', `${treeRevision}:${measuredSourcePath}`], {
                    cwd: root,
                    stdio: 'ignore',
                })
            ).not.toThrow();

            const data = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
                sourceRevision: string;
                machine: { gitSha: string };
            };
            data.sourceRevision = treeRevision;
            data.machine.gitSha = treeRevision;
            writeFileSync(jsonPath, JSON.stringify(data));
            const markdownPath = join(root, 'crates/daw-dsp/benches/quantum-cost-table.md');
            writeFileSync(markdownPath, readFileSync(markdownPath, 'utf8').replaceAll(revision, treeRevision));

            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow(
                `Grand Boule measurement source revision ${treeRevision} cannot provide ${measuredSourcePath}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a full annotated tag object ID even when it peels to the measured commit', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-measurement-tag-'));
        try {
            const { jsonPath, revision } = writeGrandBouleMeasurementFixture(root);
            execFileSync(
                'git',
                [
                    '-c',
                    'user.name=Fixture',
                    '-c',
                    'user.email=fixture@example.test',
                    'tag',
                    '--annotate',
                    '--message',
                    'measurement tag',
                    'measurement-tag',
                    revision,
                ],
                { cwd: root }
            );
            const tagRevision = execFileSync('git', ['rev-parse', 'refs/tags/measurement-tag'], {
                cwd: root,
                encoding: 'utf8',
            }).trim();
            const measuredSourcePath = 'crates/daw-dsp/benches/quantum.rs';
            expect(tagRevision).toMatch(/^[0-9a-f]{40}$/u);
            expect(execFileSync('git', ['cat-file', '-t', tagRevision], { cwd: root, encoding: 'utf8' }).trim()).toBe(
                'tag'
            );
            expect(() =>
                execFileSync('git', ['cat-file', '-e', `${tagRevision}^{commit}`], {
                    cwd: root,
                    stdio: 'ignore',
                })
            ).not.toThrow();
            expect(() =>
                execFileSync('git', ['show', `${tagRevision}:${measuredSourcePath}`], {
                    cwd: root,
                    stdio: 'ignore',
                })
            ).not.toThrow();

            const data = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
                sourceRevision: string;
                machine: { gitSha: string };
            };
            data.sourceRevision = tagRevision;
            data.machine.gitSha = tagRevision;
            writeFileSync(jsonPath, JSON.stringify(data));
            const markdownPath = join(root, 'crates/daw-dsp/benches/quantum-cost-table.md');
            writeFileSync(markdownPath, readFileSync(markdownPath, 'utf8').replaceAll(revision, tagRevision));

            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow(
                `Grand Boule measurement source revision ${tagRevision} cannot provide ${measuredSourcePath}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('cleans shallow measurement fixture directories when setup fails', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-measurement-setup-failure-'));
        let clone: string | undefined;
        let remote: string | undefined;
        try {
            expect(() =>
                writeShallowGrandBouleMeasurementFixture(root, (directories) => {
                    clone = directories.clone;
                    remote = directories.remote;
                    throw new Error('forced shallow fixture setup failure');
                })
            ).toThrow('forced shallow fixture setup failure');

            if (clone === undefined || remote === undefined) {
                throw new Error('Expected shallow fixture directories before setup failure');
            }
            expect(existsSync(clone)).toBe(false);
            expect(existsSync(remote)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects stale or decoy rounded measurement numbers in the generated Markdown region', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-measurement-render-'));
        try {
            const { jsonPath } = writeGrandBouleMeasurementFixture(root);
            const markdownPath = join(root, 'crates/daw-dsp/benches/quantum-cost-table.md');
            const originalMarkdown = readFileSync(markdownPath, 'utf8');

            writeFileSync(
                markdownPath,
                originalMarkdown.replace(
                    '| Audio thread, worst quantum, upper bound | 2.1 |',
                    '| Audio thread, worst quantum, upper bound | 9.9 |'
                )
            );
            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow(
                'generated region does not match JSON rendering'
            );

            writeFileSync(markdownPath, originalMarkdown);
            const data = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
                rows: Array<{ stats: { median: number } }>;
            };
            data.rows[0]!.stats.median = 1.125;
            writeFileSync(jsonPath, JSON.stringify(data));
            expect(() => assertGrandBouleMeasurementAdmission(root)).toThrow(
                'generated region does not match JSON rendering'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects stale Grand Boule revisions and digests through the Grand Boule assertion', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-assertion-'));
        writeGrandBouleReleaseFixture(root);

        try {
            const current = grandBouleReleaseInventoryContract(root);
            expect(() =>
                assertGrandBouleReleaseInventory(root, {
                    ...current,
                    revisions: ['stale tracked source'],
                })
            ).toThrow('Grand Boule release inventory revisions does not match provenance');
            expect(() =>
                assertGrandBouleReleaseInventory(root, {
                    ...current,
                    digests: ['tree-sha256:stale:crates/daw-dsp/src/grand_boule'],
                })
            ).toThrow('Grand Boule release inventory digests does not match provenance');

            for (const [field, value] of [
                ['retention', 'defer-behind-admission'],
                ['releaseModes', ['source']],
                ['paths', current.paths.slice(1)],
            ] as const) {
                expect(() => assertGrandBouleReleaseInventory(root, { ...current, [field]: value })).toThrow(
                    `Grand Boule release inventory ${field} does not match provenance`
                );
            }

            rmSync(join(root, 'src/modules/GrandBoule/models/GrandBouleConfig.ts'));
            expect(() => grandBouleReleaseInventoryContract(root)).toThrow(
                'Grand Boule release source is missing: src/modules/GrandBoule/models/GrandBouleConfig.ts'
            );

            writeGrandBouleReleaseFixture(root);
            const unsafeSource = 'src/modules/GrandBoule/models/GrandBouleConfig.ts';
            rmSync(join(root, unsafeSource));
            mkdirSync(join(root, unsafeSource));
            expect(() => grandBouleReleaseInventoryContract(root)).toThrow(
                `Grand Boule release source is unsafe: ${unsafeSource}`
            );
            rmSync(join(root, unsafeSource), { recursive: true, force: true });

            writeGrandBouleReleaseFixture(root);
            const preserved = grandBouleReleaseInventoryContract(root);
            rmSync(join(root, 'src/infra/release/deviceReleaseAdmission.ts'));
            expect(() => grandBouleReleaseInventoryContract(root)).toThrow(
                'Grand Boule release source is missing: src/infra/release/deviceReleaseAdmission.ts'
            );

            writeGrandBouleReleaseFixture(root);
            rmSync(join(root, 'src/modules/AudioEngine/worklets/grandBouleProcessor.ts'));
            expect(() => assertGrandBouleReleaseInventory(root, preserved)).toThrow(
                'Grand Boule release source is missing: src/modules/AudioEngine/worklets/grandBouleProcessor.ts'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds owner-created visual assets and every derived rendition', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-'));

        try {
            writeOwnerVisualAssetFixture(root);
            const before = ownerVisualAssetReleaseInventoryContract(root);
            expect(before.kind).toBe('owner-created-asset');
            expect(before.paths).toEqual(OWNER_VISUAL_ASSET_PATHS);
            expect(before.sources).toContain('owner attestation: Jose Costa, 2026-08-21');
            expect(before.licenses).toEqual(['Apache-2.0']);

            writeFileSync(join(root, 'build/icons/nested/icon.png'), 'changed');
            expect(ownerVisualAssetReleaseInventoryContract(root).digests).not.toEqual(before.digests);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a canonical owner icon with the wrong opaque background', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-background-'));

        try {
            const canonical = mutatePngPixel(repositoryOwnerCanonical, 0, 0, [5, 4, 3, 255]);
            writeOwnerVisualAssetFixture(root, { canonical });

            expect(() => ownerVisualAssetReleaseInventoryContract(root)).toThrow(
                'owner visual asset public/icon.png background must be opaque #0c0a09'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each([
        ['wrong geometry', rgbaPng(1, 1, () => ownerIconBackground), 'public/icon.png must be 480x480 RGBA'],
        [
            'non-opaque pixels',
            mutatePngPixel(repositoryOwnerCanonical, 0, 0, [12, 10, 9, 0]),
            'public/icon.png must be fully opaque',
        ],
        [
            'misaligned bread mark',
            mutatePngPixel(repositoryOwnerCanonical, 235, 25, ownerIconBackground),
            'public/icon.png mark does not align with public/icon-transparent.png',
        ],
    ] as const)('rejects canonical owner icon %s', (_label, canonical, failure) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-canonical-'));

        try {
            writeOwnerVisualAssetFixture(root, { canonical });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(`owner visual asset ${failure}`);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a single-pixel change at a matte-authored partial edge', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-partial-edge-'));

        try {
            const authority = decodePngFixture(repositoryOwnerAuthority);
            expect(authority.pixels[(81 * authority.width + 105) * 4 + 3]).toBe(128);
            const canonical = incrementPngPixelChannel(repositoryOwnerCanonical, 171, 105, 0);
            writeOwnerVisualAssetFixture(root, { canonical });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                'owner visual asset public/icon.png partial edges do not match public/icon-transparent.png authority'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a PNG with a corrupt IDAT CRC', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-png-crc-'));

        try {
            writeOwnerVisualAssetFixture(root, { canonical: flipPngChunkCrc(repositoryOwnerCanonical, 'IDAT') });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                'owner visual asset public/icon.png PNG IDAT CRC is invalid'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each([
        ['IDAT before IHDR', pngWithIdatBeforeHeader(repositoryOwnerCanonical), 'PNG IHDR must be first'],
        [
            'interleaved IDAT chunks',
            pngWithInterleavedIdat(repositoryOwnerCanonical),
            'PNG IDAT chunks must be consecutive',
        ],
        [
            'an unknown critical chunk',
            pngWithChunkAfterHeader(repositoryOwnerCanonical, Buffer.from('ABCD', 'ascii')),
            'PNG has unknown critical chunk ABCD',
        ],
        [
            'invalid chunk-type bytes',
            pngWithChunkAfterHeader(repositoryOwnerCanonical, Buffer.from([0x49, 0x44, 0, 0x54])),
            'PNG chunk type is invalid',
        ],
        [
            'trailing compressed bytes',
            pngWithTrailingCompressedBytes(repositoryOwnerCanonical),
            'PNG IDAT contains trailing compressed bytes',
        ],
    ] as const)('rejects canonical PNG grammar with %s', (_label, canonical, failure) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-png-grammar-'));

        try {
            writeOwnerVisualAssetFixture(root, { canonical });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                `owner visual asset public/icon.png ${failure}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each([
        [Buffer.alloc(ownerPngFileByteLimit + 1), `exceeds ${ownerPngFileByteLimit}-byte limit`],
        [oversizedIdatPng(), `PNG IDAT exceeds ${ownerPngIdatByteLimit}-byte limit`],
    ] as const)('bounds canonical PNG resources before decoding %#', (canonical, failure) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-png-bound-'));

        try {
            writeOwnerVisualAssetFixture(root, { canonical });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                `owner visual asset public/icon.png ${failure}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(ownerIcnsFrames)('rejects an ICNS missing required %s frame', (missingFrame) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-icns-'));

        try {
            writeOwnerVisualAssetFixture(root, {
                icnsFrames: ownerIcnsFrames.filter((frame) => frame !== missingFrame),
            });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                `owner visual asset build/icons/icon.icns is missing frame ${missingFrame}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(ownerIcnsFrames)('rejects malformed payload data in required ICNS %s frame', (malformedFrame) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-icns-payload-'));

        try {
            writeOwnerVisualAssetFixture(root, { malformedIcnsFrame: malformedFrame });

            const failure =
                malformedFrame === 'ic04' || malformedFrame === 'ic05'
                    ? `owner visual asset build/icons/icon.icns ${malformedFrame} frame is not ARGB`
                    : `owner visual asset build/icons/icon.icns ${malformedFrame} is not a PNG`;
            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(failure);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a high-bit alias of the ICNS container magic', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-icns-magic-'));

        try {
            writeOwnerVisualAssetFixture(root, { highBitIcnsMagic: true });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                'owner visual asset build/icons/icon.icns has an invalid container header'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(ownerIcnsFrames)('rejects a high-bit alias of required ICNS %s frame type', (highBitFrame) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-icns-fourcc-'));

        try {
            writeOwnerVisualAssetFixture(root, { highBitIcnsFrame: highBitFrame });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                `owner visual asset build/icons/icon.icns is missing frame ${highBitFrame}`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(['ic04', 'ic05'] as const)('rejects a high-bit alias of legacy ICNS %s ARGB magic', (highBitFrame) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-icns-argb-'));

        try {
            writeOwnerVisualAssetFixture(root, { highBitIcnsArgbFrame: highBitFrame });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                `owner visual asset build/icons/icon.icns ${highBitFrame} frame is not ARGB`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(['ic04', 'ic05'] as const)('rejects repaired legacy ICNS %s blue-tail seam pixels', (seamFrame) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-icns-seam-'));

        try {
            writeOwnerVisualAssetFixture(root, { seamIcnsFrame: seamFrame });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                `owner visual asset build/icons/icon.icns ${seamFrame} frame contains #0c0a00 seam pixels`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(ownerIcnsFrames)('rejects wrong decoded pixels in required ICNS %s frame', (wrongPixelsFrame) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-icns-pixels-'));

        try {
            writeOwnerVisualAssetFixture(root, { wrongPixelsIcnsFrame: wrongPixelsFrame });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                `owner visual asset build/icons/icon.icns ${wrongPixelsFrame} pixels do not match the shipped rendition`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(ownerPngIcnsFrames)('rejects a valid PNG at the wrong ICNS %s frame dimensions', (wrongFrame) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-icns-dimensions-'));

        try {
            writeOwnerVisualAssetFixture(root, { wrongDimensionIcnsFrame: wrongFrame });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                `owner visual asset build/icons/icon.icns ${wrongFrame} frame must be ${ownerIcnsFrameSizes[wrongFrame]}x${ownerIcnsFrameSizes[wrongFrame]} RGBA`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each([
        ['missing', [16, 32, 48, 64, 256]],
        ['unexpected', [16, 20, 32, 48, 64, 256]],
    ] as const)('rejects an ICO with %s frame sizes', (_label, frames) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-ico-'));

        try {
            writeOwnerVisualAssetFixture(root, { icoFrames: frames });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                'owner visual asset build/icons/icon.ico frame sizes must be 16,24,32,48,64,256'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects overlapping ICO frame payloads', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-ico-overlap-'));

        try {
            writeOwnerVisualAssetFixture(root, { overlappingIcoPayloads: true });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                'owner visual asset build/icons/icon.ico has overlapping frame payloads'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects malformed ICO frame payload data', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-ico-payload-'));

        try {
            writeOwnerVisualAssetFixture(root, { malformedIcoSize: 24 });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                'owner visual asset build/icons/icon.ico 24x24 is not a PNG'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it.each(ownerIcoFrames)('rejects wrong decoded pixels in required ICO %spx frame', (wrongPixelsSize) => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-ico-pixels-'));

        try {
            writeOwnerVisualAssetFixture(root, { wrongPixelsIcoSize: wrongPixelsSize });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                `owner visual asset build/icons/icon.ico ${wrongPixelsSize}px frame pixels do not match the shipped rendition`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects an ICO payload whose PNG dimensions disagree with its directory entry', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-ico-dimensions-'));

        try {
            writeOwnerVisualAssetFixture(root, { wrongDimensionIcoSize: 24 });

            expect(() => assertOwnerVisualAssetIntegrity(root)).toThrow(
                'owner visual asset build/icons/icon.ico 24px frame payload has wrong dimensions'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('routes malformed ICNS through the release inventory contract', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-contract-icns-'));

        try {
            writeOwnerVisualAssetFixture(root, { malformedIcnsFrame: 'ic07' });

            expect(() => ownerVisualAssetReleaseInventoryContract(root)).toThrow(
                'owner visual asset build/icons/icon.icns ic07 is not a PNG'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('routes wrong-dimension ICO payloads through the release inventory contract', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-contract-ico-'));

        try {
            writeOwnerVisualAssetFixture(root, { wrongDimensionIcoSize: 24 });

            expect(() => ownerVisualAssetReleaseInventoryContract(root)).toThrow(
                'owner visual asset build/icons/icon.ico 24px frame payload has wrong dimensions'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds the shipped trademark notice', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-trademark-notice-'));
        const legal = join(root, 'public/legal');
        mkdirSync(legal, { recursive: true });
        writeFileSync(join(root, TRADEMARK_NOTICE_PATH), 'notice');

        try {
            const before = trademarkReleaseInventoryContract(root);
            expect(TRADEMARK_NOTICE_PATH).toBe('public/legal/TRADEMARKS.md');
            expect(before.licenses).toEqual(['not-applicable:trademark-rights-not-granted']);

            writeFileSync(join(root, TRADEMARK_NOTICE_PATH), 'changed');
            expect(trademarkReleaseInventoryContract(root).digests).not.toEqual(before.digests);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds direct worklet source bytes without inventing a generator', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-worklet-provenance-'));
        const worklets = join(root, 'public/audio/worklets');
        mkdirSync(worklets, { recursive: true });
        writeFileSync(join(worklets, 'native-plugin-bridge-processor.js'), 'native');
        writeFileSync(join(worklets, 'sidechain-compressor-processor.js'), 'sidechain');

        try {
            const before = audioWorkletReleaseInventoryContract(root);
            expect(before.kind).toBe('project-source');
            expect(before.revisions).toEqual(['not-applicable:direct-project-source']);

            writeFileSync(join(worklets, 'native-plugin-bridge-processor.js'), 'changed');
            expect(audioWorkletReleaseInventoryContract(root).digests[0]).not.toBe(before.digests[0]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds the adapted MIT source and exact upstream license bytes', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-adapted-mit-'));
        mkdirSync(join(root, 'crates/daw-dsp/src/toaster/engines'), { recursive: true });
        mkdirSync(join(root, 'public/legal'), { recursive: true });
        mkdirSync(join(root, 'release/upstream-proofs'), { recursive: true });
        writeFileSync(join(root, ADAPTED_MIT_SOURCE_PATH), 'adapted source');
        writeFileSync(
            join(root, ADAPTED_MIT_LICENSE_PATH),
            readFileSync(join(repositoryRoot, ADAPTED_MIT_LICENSE_PATH))
        );
        writeFileSync(join(root, ADAPTED_ORIGINAL_MIT_LICENSE_PATH), 'original upstream license');
        writeFileSync(join(root, ADAPTED_MIT_NOTICE_PATH), 'public notice');
        writeFileSync(
            join(root, ADAPTED_MIT_UPSTREAM_PROOF_PATH),
            readFileSync(join(repositoryRoot, ADAPTED_MIT_UPSTREAM_PROOF_PATH))
        );
        writeFileSync(
            join(root, ADAPTED_MIT_LICENSE_PROOF_PATH),
            readFileSync(join(repositoryRoot, ADAPTED_MIT_LICENSE_PROOF_PATH))
        );
        writeFileSync(
            join(root, ADAPTED_ORIGINAL_UPSTREAM_PROOF_PATH),
            readFileSync(join(repositoryRoot, ADAPTED_ORIGINAL_UPSTREAM_PROOF_PATH))
        );

        try {
            const before = adaptedMitSourceReleaseInventoryContract(root);
            expect(before.licenses).toEqual(['MIT']);
            expect(before.revisions).toEqual([ADAPTED_MIT_COMMIT, ADAPTED_ORIGINAL_COMMIT]);
            expect(before.sources).toContain(
                `git:github.com/pichenettes/eurorack@${ADAPTED_ORIGINAL_COMMIT}:${ADAPTED_ORIGINAL_SOURCE_PATH}`
            );
            expect(before.digests).toContain(
                `sha256:${ADAPTED_ORIGINAL_SOURCE_SHA256}:git:github.com/pichenettes/eurorack@${ADAPTED_ORIGINAL_COMMIT}:${ADAPTED_ORIGINAL_SOURCE_PATH}`
            );
            expect(before.digests).toContain(
                `sha256:b2ec3cd241dd660bd4de9f07dd94ecce3ee9c696eaf15af7af68eae6ed4af04c:git:github.com/sourcebox/mi-plaits-dsp-rs@${ADAPTED_MIT_COMMIT}:LICENSE.txt`
            );

            writeFileSync(join(root, ADAPTED_MIT_LICENSE_PROOF_PATH), 'changed upstream license proof');
            expect(() => adaptedMitSourceReleaseInventoryContract(root)).toThrow(
                'pinned upstream license proof drifted'
            );
            writeFileSync(
                join(root, ADAPTED_MIT_LICENSE_PROOF_PATH),
                readFileSync(join(repositoryRoot, ADAPTED_MIT_LICENSE_PROOF_PATH))
            );

            writeFileSync(join(root, ADAPTED_MIT_SOURCE_PATH), 'changed');
            expect(adaptedMitSourceReleaseInventoryContract(root).digests[0]).not.toBe(before.digests[0]);

            writeFileSync(join(root, ADAPTED_ORIGINAL_MIT_LICENSE_PATH), 'changed original license');
            expect(adaptedMitSourceReleaseInventoryContract(root).digests[7]).not.toBe(before.digests[7]);

            writeFileSync(join(root, ADAPTED_MIT_NOTICE_PATH), 'changed public notice');
            expect(adaptedMitSourceReleaseInventoryContract(root).digests[8]).not.toBe(before.digests[8]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds the WASM manifest to its toolchain and crate closures', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-wasm-provenance-'));
        mkdirSync(join(root, 'public/wasm'), { recursive: true });
        writeFileSync(join(root, 'public/wasm/manifest.json'), '{}');
        const manifest: WasmManifest = {
            comment: 'fixture',
            toolchain: {
                wasmPack: '1',
                wasmBindgen: '2',
                rustToolchain: '3',
                wasmOpt: '4',
            },
            packages: {
                beta: { crate: 'crates/beta', crateSourceHash: 'sha256:beta', schemaHash: 'beta', artifacts: {} },
                alpha: { crate: 'crates/alpha', crateSourceHash: 'sha256:alpha', schemaHash: 'alpha', artifacts: {} },
            },
        };

        try {
            const contract = wasmReleaseInventoryContract(root, manifest);
            expect(contract.sources).toEqual(['crates/alpha/', 'crates/beta/']);
            expect(contract.revisions).toEqual([
                'rust 3',
                'wasm-pack 1',
                'wasm-bindgen 2',
                'wasm-opt 4',
                'alpha sha256:alpha',
                'beta sha256:beta',
            ]);
            expect(contract.digests).toEqual([
                expect.stringMatching(/^sha256:[0-9a-f]{64}:public\/wasm\/manifest\.json$/),
            ]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('keeps every served WASM package out of npm publication and rebuild scripts restore that state', () => {
        const scripts = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        for (const { id, buildScript } of wasmArtifacts.packages) {
            const metadata = JSON.parse(
                readFileSync(join(repositoryRoot, 'public/wasm', id, 'package.json'), 'utf8')
            ) as {
                private?: unknown;
                license?: unknown;
            };
            expect(metadata.private).toBe(true);
            expect(metadata.license).toBe('Apache-2.0');
            expect(scripts.scripts[buildScript]).toContain(`markWasmPackageInternal.ts ${id}`);
        }
    });

    it('accepts complete classified coverage', () => {
        expect(validateReleaseInventory(inventory(), snapshot())).toEqual([]);
    });

    it('rejects unresolved rights on a retained keep surface', () => {
        const value = inventory();
        value.surfaces[0]!.retention = 'keep';
        value.surfaces[0]!.licenses = ['Apache-2.0', 'unverified:unknown-rights'];

        expect(validateReleaseInventory(value, snapshot())).toContain(
            'runtime: keep surfaces cannot carry unverified rights'
        );
    });

    it('rejects duplicate inventory keys before JSON consumption', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-duplicate-inventory-'));
        try {
            mkdirSync(join(root, 'release'), { recursive: true });
            writeFileSync(join(root, 'release/open-source-inventory.json'), '{"surface":{"id":"one","id":"two"}}');
            expect(() => readReleaseInventory(root)).toThrow('duplicate key');
            writeFileSync(join(root, 'release/open-source-inventory.json'), '');
            expect(() => readReleaseInventory(root)).toThrow('invalid JSON');
            writeFileSync(join(root, 'release/open-source-inventory.json'), '{"surface":]');
            expect(() => readReleaseInventory(root)).toThrow('invalid JSON');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds the project-license distribution surface to generated legal evidence', () => {
        const contract = projectLicenseDistributionReleaseInventoryContract(repositoryRoot);
        expect(contract.paths).toContain('release/dependency-license-proofs.json');
        expect(contract.paths).toContain('release/upstream-proofs/**');
        expect(
            contract.digests.some((digest) =>
                /^sha256:[0-9a-f]{64}:public\/legal\/DEPENDENCY-LICENSES\.txt$/u.test(digest)
            )
        ).toBe(true);
        const surface = readReleaseInventory(repositoryRoot).surfaces.find(
            (candidate) => candidate.id === 'project-license-distribution'
        );
        expect(() => assertProjectLicenseDistributionReleaseInventory(repositoryRoot, surface)).not.toThrow();
        expect(() =>
            assertProjectLicenseDistributionReleaseInventory(repositoryRoot, {
                ...(surface ?? {}),
                digests: ['sha256:stale:LICENSE'],
            })
        ).toThrow('project license distribution release inventory digests does not match provenance');
    });

    it('rejects a new release file without a classification', () => {
        expect(
            validateReleaseInventory(inventory(), {
                ...snapshot(),
                releaseFiles: [...snapshot().releaseFiles, 'electron/sidecar/new.bin'],
            })
        ).toContain('unclassified release files:\n- electron/sidecar/new.bin');
    });

    it('rejects a new endpoint in an already-owned file', () => {
        expect(
            validateReleaseInventory(inventory(), {
                ...snapshot(),
                externalReferences: [
                    ...snapshot().externalReferences,
                    { file: 'src/provider.ts', value: 'https://second.example/v1' },
                ],
            })
        ).toContain('external references missing from inventory:\n- src/provider.ts -> https://second.example/v1');
    });

    it('rejects stale endpoint assignments', () => {
        expect(validateReleaseInventory(inventory(), { ...snapshot(), externalReferences: [] })).toContain(
            'stale external-reference assignments:\n- src/provider.ts -> https://provider.example/v1'
        );
    });

    it('rejects endpoint assignments to an unrelated surface', () => {
        const value = inventory();
        value.surfaces.push({ ...value.surfaces[0]!, id: 'docs', paths: ['docs/**'] });
        value.externalReferences[0]!.surface = 'docs';

        expect(validateReleaseInventory(value, snapshot())).toContain(
            'src/provider.ts: docs does not cover the referenced file'
        );
    });

    it('does not let a directory rule swallow a sibling prefix', () => {
        expect(
            validateReleaseInventory(inventory(), {
                ...snapshot(),
                releaseFiles: [...snapshot().releaseFiles, 'publicity/icon.png'],
            })
        ).toContain('unclassified release files:\n- publicity/icon.png');
    });

    it('rejects unclassified retention', () => {
        const value = inventory();
        value.surfaces[0]!.retention = 'unclassified' as never;

        expect(validateReleaseInventory(value, snapshot())).toContain('runtime: invalid retention class unclassified');
    });

    it('rejects removal of a required snapshot', () => {
        const value = inventory();
        value.snapshots = value.snapshots.filter((entry) => entry.path !== 'pnpm-lock.yaml');

        expect(validateReleaseInventory(value, snapshot())).toContain(
            'required snapshots missing from inventory:\n- pnpm-lock.yaml'
        );
    });

    it('binds every dependency lock digest to its owning surface snapshot', () => {
        const value = inventory();
        for (const id of ['javascript-dependencies', 'collaboration-server', 'rust-dependencies']) {
            value.surfaces.push({ ...value.surfaces[0]!, id, digests: ['sha256:stale'] });
        }

        expect(validateReleaseInventory(value, snapshot())).toEqual(
            expect.arrayContaining([
                `javascript-dependencies: digest must match pnpm-lock.yaml snapshot (sha256:${fixtureDigest})`,
                `javascript-dependencies: digest must match server/package-lock.json snapshot (sha256:${fixtureDigest})`,
                `collaboration-server: digest must match server/package-lock.json snapshot (sha256:${fixtureDigest})`,
                `rust-dependencies: digest must match Cargo.lock snapshot (sha256:${fixtureDigest})`,
            ])
        );
    });

    it('passes the captured inventory marker scan to the project-license preflight', () => {
        let called = false;
        const capturedInventory = inventory();

        expect(() =>
            checkReleaseInventory(
                '/inventory-is-not-read',
                (_root, inventoryContents) => {
                    called = true;
                    expect(inventoryContents).toBe(JSON.stringify(capturedInventory));
                    throw new Error('project license preflight sentinel');
                },
                capturedInventory
            )
        ).toThrow('project license preflight sentinel');
        expect(called).toBe(true);
    });

    it('rejects snapshots outside the tracked repository', () => {
        const value = inventory();
        value.snapshots.push({ path: 'untracked.lock', sha256: fixtureDigest });

        expect(validateReleaseInventory(value, snapshot())).toContain('untracked.lock: snapshot path must be tracked');
    });

    it('rejects missing required marks and empty mark assignments', () => {
        const value = inventory();
        value.marks = [{ value: 'Neve', paths: [] }];

        expect(validateReleaseInventory(value, snapshot(), ['Roland'])).toEqual(
            expect.arrayContaining([
                'required marks missing from inventory:\n- Roland',
                'Neve: paths must be non-empty',
            ])
        );
    });

    it('requires the trademark notice beside every classified mark path', () => {
        const value = inventory();
        value.surfaces.push({
            ...value.surfaces[0]!,
            id: 'third-party-marks',
            paths: ['src/provider.ts'],
        });
        value.marks = [{ value: 'Roland', paths: ['src/provider.ts'] }];
        const state = snapshot();
        state.markPaths = { Roland: ['src/provider.ts'] };

        expect(validateReleaseInventory(value, state, ['Roland'])).toContain(
            `third-party-marks: required notice missing: ${TRADEMARK_NOTICE_PATH}`
        );
    });

    it('rejects component paths that fall through to a generic surface', () => {
        const value = inventory();
        value.surfaces.push({ ...value.surfaces[0]!, id: 'generic', paths: ['src/**'] });
        value.surfaces[0]!.paths = value.surfaces[0]!.paths.filter((path) => path !== 'src/**');

        expect(validateReleaseInventory(value, snapshot(), [], { runtime: ['src/provider.ts'] })).toContain(
            'runtime: required component paths missing:\n- src/provider.ts'
        );
    });

    it('rejects surface paths that match no tracked file', () => {
        const value = inventory();
        value.surfaces[0]!.paths.push('missing/**');

        expect(validateReleaseInventory(value, snapshot())).toContain('runtime: path is not tracked: missing/**');
    });

    it('discovers shipped assets and non-HTTP production endpoints', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(
            join(root, 'src/peer.ts'),
            "export const server = 'stun:stun.example.net:19302';\nexport const api = 'https:\\/\\/provider.example.net/v1';\nexport const dynamic = `https://api.example.net/files/${name.split('/')}`;\nexport const model = 'Hammond';\n// Never treat substrings as marks.\n"
        );
        writeFileSync(join(root, 'src/peer.spec.ts'), "export const fixture = 'https://fixture.example.net';\n");
        writeFileSync(join(root, 'sourdaw.png'), 'image');
        writeFileSync(join(root, 'notes.txt'), 'not shipped');

        try {
            const result = loadRepositorySnapshot(
                root,
                {
                    snapshots: [{ path: 'notes.txt', sha256: 'unused' }],
                    marks: [
                        { value: 'Hammond', paths: [] },
                        { value: 'Neve', paths: [] },
                    ],
                },
                ['notes.txt', 'sourdaw.png', 'src/peer.spec.ts', 'src/peer.ts']
            );
            expect(result.releaseFiles).toEqual(['notes.txt', 'sourdaw.png', 'src/peer.spec.ts', 'src/peer.ts']);
            expect(result.externalReferences).toEqual([
                {
                    file: 'src/peer.ts',
                    value: 'https://api.example.net/files/${slot}',
                    templateSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
                },
                { file: 'src/peer.ts', value: 'https://provider.example.net/v1' },
                { file: 'src/peer.ts', value: 'stun:stun.example.net:19302' },
            ]);
            expect(result.fileDigests['notes.txt']).toMatch(/^[0-9a-f]{64}$/);
            expect(result.markPaths).toEqual({ Hammond: ['src/peer.ts'], Neve: [] });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('does not treat verbatim dependency license text as product provenance or trademark claims', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(dirname(join(root, DEPENDENCY_LICENSE_REPORT_PATH)), { recursive: true });
        writeFileSync(
            join(root, DEPENDENCY_LICENSE_REPORT_PATH),
            'Exact third-party terms mention https://license.example and Roland.'
        );

        try {
            const result = loadRepositorySnapshot(root, { snapshots: [], marks: [{ value: 'Roland', paths: [] }] }, [
                DEPENDENCY_LICENSE_REPORT_PATH,
            ]);
            expect(result.releaseFiles).toEqual([DEPENDENCY_LICENSE_REPORT_PATH]);
            expect(result.externalReferences).toEqual([]);
            expect(result.markPaths).toEqual({ Roland: [] });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('ignores tracked files deleted from the working tree', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src/current.ts'), "export const value = 'current';\n");

        try {
            const result = loadRepositorySnapshot(root, { snapshots: [], marks: [] }, [
                'src/current.ts',
                'src/deleted.ts',
            ]);

            expect(result.releaseFiles).toEqual(['src/current.ts']);
            expect(result.externalReferences).toEqual([]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('scans production endpoints plus case-insensitive public marks', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(join(root, 'crates/plugin-host/src'), { recursive: true });
        mkdirSync(join(root, 'public'), { recursive: true });
        mkdirSync(join(root, 'server'), { recursive: true });
        writeFileSync(
            join(root, 'crates/plugin-host/src/descriptor.rs'),
            'static URL: &[u8] = b"https://app.example.net\\0";\n'
        );
        writeFileSync(join(root, 'index.html'), '<title>Roland tools</title>');
        writeFileSync(
            join(root, 'public/runtime.js'),
            "export const api = 'https://public.example.net/v1'; // ROLAND\n"
        );
        writeFileSync(
            join(root, 'server/index.js'),
            "export const api = 'wss://server.example.net/socket';\nnew WebSocket(api);\n"
        );

        try {
            const result = loadRepositorySnapshot(root, { snapshots: [], marks: [{ value: 'Roland', paths: [] }] }, [
                'crates/plugin-host/src/descriptor.rs',
                'index.html',
                'public/runtime.js',
                'server/index.js',
            ]);
            expect(result.externalReferences).toEqual([
                { file: 'crates/plugin-host/src/descriptor.rs', value: 'https://app.example.net' },
                { file: 'public/runtime.js', value: 'https://public.example.net/v1' },
                { file: 'server/index.js', value: 'runtime:WebSocket' },
                { file: 'server/index.js', value: 'wss://server.example.net/socket' },
            ]);
            expect(result.markPaths).toEqual({ Roland: ['index.html', 'public/runtime.js'] });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('detects template-expression drift', () => {
        const value = inventory();
        value.externalReferences[0]!.templateSha256 = fixtureDigest;
        const changed = snapshot();
        changed.externalReferences[0]!.templateSha256 = 'b'.repeat(64);

        expect(validateReleaseInventory(value, changed)).toEqual(
            expect.arrayContaining([
                expect.stringContaining('external references missing from inventory'),
                expect.stringContaining('stale external-reference assignments'),
            ])
        );
    });
});
