import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

import { NATIVE_ADDON_FILE, NATIVE_SCAN_HELPER_FILE } from '../electron/native.ts';
import { electronReleaseTarget, type ElectronReleaseTarget } from './electronRuntimeContract.ts';

type ImageReader = {
    read: (offset: number, length: number) => Promise<Buffer>;
    range: (offset: bigint, length: bigint) => void;
};

function requireImage(condition: boolean, reason: string): asserts condition {
    if (!condition) throw new Error(reason);
}

function imageReader(file: FileHandle, size: number): ImageReader {
    let remaining = 1024 * 1024;
    const range = (offset: bigint, length: bigint): void => {
        requireImage(
            offset >= 0n && length >= 0n && offset + length <= BigInt(size),
            'truncated image or invalid offset'
        );
    };
    return {
        range,
        async read(offset, length) {
            requireImage(Number.isSafeInteger(offset) && Number.isSafeInteger(length), 'invalid header offset');
            range(BigInt(offset), BigInt(length));
            remaining -= length;
            requireImage(remaining >= 0, 'native image metadata exceeds verification budget');
            const bytes = Buffer.alloc(length);
            let consumed = 0;
            while (consumed < length) {
                const result = await file.read(bytes, consumed, length - consumed, offset + consumed);
                requireImage(result.bytesRead > 0, 'truncated image while reading headers');
                consumed += result.bytesRead;
            }
            return bytes;
        },
    };
}

// Layouts: Apple mach-o/loader.h, the ELF gABI, and Microsoft's PE format.
async function verifyMachO(reader: ImageReader, header: Buffer, addon: boolean): Promise<void> {
    requireImage(header.readUInt32LE(0) === 0xfeedfacf, 'expected thin little-endian 64-bit Mach-O');
    requireImage(header.readUInt32LE(4) === 0x0100000c, 'Mach-O CPU does not match arm64');
    const kind = header.readUInt32LE(12);
    requireImage(addon ? kind === 6 || kind === 8 : kind === 2, 'wrong Mach-O binary kind');
    const count = header.readUInt32LE(16);
    const commandBytes = header.readUInt32LE(20);
    reader.range(32n, BigInt(commandBytes));
    requireImage(count > 0 && count <= commandBytes / 8, 'invalid Mach-O load commands');
    let cursor = 32;
    let macOS = false;
    let hasSegment = false;
    for (let index = 0; index < count; index += 1) {
        requireImage(cursor + 8 <= 32 + commandBytes, 'invalid Mach-O load command offset');
        const command = await reader.read(cursor, 8);
        const type = command.readUInt32LE(0);
        const length = command.readUInt32LE(4);
        requireImage(
            length >= 8 && length % 8 === 0 && cursor + length <= 32 + commandBytes,
            'invalid Mach-O load command size'
        );
        if (type === 0x32) {
            requireImage(length >= 24, 'truncated Mach-O build version');
            const version = await reader.read(cursor, 24);
            requireImage(version.readUInt32LE(8) === 1, 'Mach-O platform is not macOS');
            requireImage(24 + version.readUInt32LE(20) * 8 <= length, 'invalid Mach-O build tools');
            macOS = true;
        } else if (type === 0x24) {
            requireImage(length >= 16, 'truncated Mach-O minimum macOS version');
            macOS = true;
        } else if (type === 0x19) {
            requireImage(length >= 72, 'truncated Mach-O segment');
            const segment = await reader.read(cursor, 72);
            reader.range(segment.readBigUInt64LE(40), segment.readBigUInt64LE(48));
            requireImage(72 + segment.readUInt32LE(64) * 80 <= length, 'invalid Mach-O section table');
            hasSegment ||= segment.readBigUInt64LE(48) > 0n;
        }
        cursor += length;
    }
    requireImage(cursor === 32 + commandBytes && macOS && hasSegment, 'missing macOS platform or file-backed segment');
}

async function verifyElf(
    reader: ImageReader,
    header: Buffer,
    target: ElectronReleaseTarget,
    addon: boolean
): Promise<void> {
    requireImage(header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), 'expected ELF image');
    requireImage(header[4] === 2 && header[5] === 1 && header[6] === 1, 'expected little-endian ELF64 version 1');
    requireImage(header[7] === 0 || header[7] === 3, 'ELF OS ABI is not System V/Linux');
    requireImage(
        header.readUInt16LE(18) === (target.arch === 'x64' ? 62 : 183),
        `ELF CPU does not match ${target.arch}`
    );
    requireImage(header.readUInt32LE(20) === 1 && header.readUInt16LE(52) === 64, 'invalid ELF header');
    const kind = header.readUInt16LE(16);
    const entry = header.readBigUInt64LE(24);
    requireImage(
        addon ? kind === 3 && entry === 0n : (kind === 2 || kind === 3) && entry !== 0n,
        'wrong ELF binary kind or entry point'
    );
    const offset = header.readBigUInt64LE(32);
    const count = header.readUInt16LE(56);
    requireImage(count > 0 && header.readUInt16LE(54) === 56 && offset >= 64n, 'invalid ELF program header table');
    reader.range(offset, BigInt(count) * 56n);
    let hasLoad = false;
    for (let index = 0; index < count; index += 1) {
        const program = await reader.read(Number(offset) + index * 56, 56);
        const type = program.readUInt32LE(0);
        const length = program.readBigUInt64LE(32);
        reader.range(program.readBigUInt64LE(8), length);
        requireImage(!addon || type !== 3, 'ELF addon has an executable interpreter');
        if (type === 1 && length > 0n) hasLoad = true;
    }
    const sections = header.readUInt16LE(60);
    if (sections > 0) {
        requireImage(header.readUInt16LE(58) === 64, 'invalid ELF section header size');
        reader.range(header.readBigUInt64LE(40), BigInt(sections) * 64n);
    }
    requireImage(hasLoad, 'ELF image has no file-backed load segment');
}

async function verifyPe(reader: ImageReader, header: Buffer, addon: boolean): Promise<void> {
    requireImage(header.toString('ascii', 0, 2) === 'MZ', 'expected PE image');
    const offset = header.readUInt32LE(60);
    requireImage(offset >= 64, 'invalid PE header offset');
    const coff = await reader.read(offset, 24);
    requireImage(coff.readUInt32LE(0) === 0x4550, 'invalid PE signature');
    requireImage(coff.readUInt16LE(4) === 0x8664, 'PE CPU does not match x64');
    const flags = coff.readUInt16LE(22);
    requireImage((flags & 2) !== 0 && ((flags & 0x2000) !== 0) === addon, 'wrong PE binary kind');
    const optionalSize = coff.readUInt16LE(20);
    requireImage(optionalSize >= 112, 'truncated PE32+ optional header');
    reader.range(BigInt(offset + 24), BigInt(optionalSize));
    const optional = await reader.read(offset + 24, 112);
    requireImage(optional.readUInt16LE(0) === 0x20b, 'expected PE32+ image');
    requireImage([2, 3].includes(optional.readUInt16LE(68)), 'PE subsystem is not Windows GUI/CUI');
    requireImage(112 + optional.readUInt32LE(108) * 8 <= optionalSize, 'invalid PE data directory table');
    const count = coff.readUInt16LE(6);
    requireImage(count > 0 && count <= 96, 'invalid PE section count');
    const sections = offset + 24 + optionalSize;
    reader.range(BigInt(sections), BigInt(count) * 40n);
    let hasData = false;
    for (let index = 0; index < count; index += 1) {
        const section = await reader.read(sections + index * 40, 40);
        const length = section.readUInt32LE(16);
        reader.range(BigInt(section.readUInt32LE(20)), BigInt(length));
        hasData ||= length > 0;
    }
    requireImage(hasData, 'PE image has no file-backed sections');
}

async function verifyArtifact(path: string, target: ElectronReleaseTarget, addon: boolean): Promise<void> {
    try {
        const file = await open(path, 'r');
        try {
            const stat = await file.stat();
            requireImage(stat.isFile(), 'native artifact is not a regular file');
            // Windows stat/chmod cannot establish Unix execute bits during cross-packaging.
            requireImage(
                addon || target.platform === 'win32' || process.platform === 'win32' || (stat.mode & 0o111) !== 0,
                'helper is not executable'
            );
            const reader = imageReader(file, stat.size);
            const header = await reader.read(0, 64);
            if (target.platform === 'darwin') await verifyMachO(reader, header, addon);
            else if (target.platform === 'linux') await verifyElf(reader, header, target, addon);
            else await verifyPe(reader, header, addon);
        } finally {
            await file.close();
        }
    } catch (cause) {
        throw new Error(
            `Native artifact ${path} does not match ${target.platform}/${target.arch}: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause }
        );
    }
}

/** Inspect packaged bytes, never the build host or an artifact's fixed filename. */
export async function verifyPackagedNativeArtifacts(
    resourcesPath: string,
    platform: string,
    arch: number
): Promise<void> {
    const target = electronReleaseTarget(platform, arch);
    if (target === undefined) throw new Error(`Unsupported packaged native target ${platform}/${String(arch)}`);
    await verifyArtifact(join(resourcesPath, NATIVE_ADDON_FILE), target, true);
    await verifyArtifact(join(resourcesPath, NATIVE_SCAN_HELPER_FILE(target.platform)), target, false);
}
