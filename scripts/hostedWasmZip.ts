import { crc32, inflateRawSync } from 'node:zlib';

export const hostedWasmOutputLimit = 10 * 1024 * 1024;

export function assertCanonicalArtifactPath(path: string): void {
    if (
        !path ||
        path.includes('\\') ||
        path.split('/').some((part) => !part || part === '.' || part === '..') ||
        path.includes('\0')
    ) {
        throw new Error(`Non-canonical artifact path: ${path}`);
    }
}

type Directory = { start: number; end: number; count: number };
type CentralEntry = {
    path: string;
    nameBytes: Buffer;
    start: number;
    flags: number;
    method: number;
    crc: number;
    compressedSize: number;
    size: number;
    version: number;
    timestamp: number;
    next: number;
};
type LocalEntry = CentralEntry & { end: number; compressedStart: number };

function readDirectory(zip: Buffer, maximumMembers: number): Directory {
    if (zip.length < 22 || zip.length > hostedWasmOutputLimit) {
        throw new Error('ZIP size is outside the hosted artifact bound');
    }
    const end = zip.length - 22;
    if (
        zip.readUInt32LE(end) !== 0x06054b50 ||
        zip.readUInt16LE(end + 20) !== 0 ||
        zip.readUInt16LE(end + 4) !== 0 ||
        zip.readUInt16LE(end + 6) !== 0
    ) {
        throw new Error('Unsupported ZIP end record');
    }
    const count = zip.readUInt16LE(end + 10);
    const size = zip.readUInt32LE(end + 12);
    const start = zip.readUInt32LE(end + 16);
    if (count === 0 || count > maximumMembers || count !== zip.readUInt16LE(end + 8) || start + size !== end) {
        throw new Error('Invalid ZIP central directory');
    }
    return { start, end, count };
}

function readCentralEntry(zip: Buffer, cursor: number, directory: Directory): CentralEntry {
    if (cursor + 46 > directory.end || zip.readUInt32LE(cursor) !== 0x02014b50) {
        throw new Error('Invalid ZIP central entry');
    }
    const flags = zip.readUInt16LE(cursor + 8);
    const method = zip.readUInt16LE(cursor + 10);
    const version = zip.readUInt16LE(cursor + 6);
    const attributes = zip.readUInt32LE(cursor + 38);
    const fileType = (attributes >>> 16) & 0xf000;
    if (
        version > 20 ||
        (flags & ~0x808) !== 0 ||
        (method !== 0 && method !== 8) ||
        (fileType !== 0 && fileType !== 0x8000) ||
        (attributes & 0x10) !== 0 ||
        zip.readUInt16LE(cursor + 34) !== 0 ||
        zip.readUInt16LE(cursor + 30) !== 0 ||
        zip.readUInt16LE(cursor + 32) !== 0
    ) {
        throw new Error('Unsupported ZIP flags, type, disk, or extension');
    }
    const nameSize = zip.readUInt16LE(cursor + 28);
    const start = zip.readUInt32LE(cursor + 42);
    if (
        cursor + 46 + nameSize > directory.end ||
        start + 30 > directory.start ||
        zip.readUInt32LE(start) !== 0x04034b50
    ) {
        throw new Error('Invalid ZIP member bounds');
    }
    const nameBytes = zip.subarray(cursor + 46, cursor + 46 + nameSize);
    const path = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    assertCanonicalArtifactPath(path);
    return {
        path,
        nameBytes,
        start,
        flags,
        method,
        version,
        timestamp: zip.readUInt32LE(cursor + 12),
        crc: zip.readUInt32LE(cursor + 16),
        compressedSize: zip.readUInt32LE(cursor + 20),
        size: zip.readUInt32LE(cursor + 24),
        next: cursor + 46 + nameSize,
    };
}

function descriptorEnd(zip: Buffer, compressedEnd: number, directoryStart: number, entry: CentralEntry): number {
    if (compressedEnd + 12 > directoryStart) {
        throw new Error('Missing ZIP data descriptor');
    }
    const descriptor = zip.readUInt32LE(compressedEnd) === 0x08074b50 ? compressedEnd + 4 : compressedEnd;
    if (
        descriptor + 12 > directoryStart ||
        zip.readUInt32LE(descriptor) !== entry.crc ||
        zip.readUInt32LE(descriptor + 4) !== entry.compressedSize ||
        zip.readUInt32LE(descriptor + 8) !== entry.size
    ) {
        throw new Error('ZIP data descriptor disagrees with central entry');
    }
    return descriptor + 12;
}

function readLocalEntry(zip: Buffer, entry: CentralEntry, directoryStart: number): LocalEntry {
    const localNameSize = zip.readUInt16LE(entry.start + 26);
    const localExtraSize = zip.readUInt16LE(entry.start + 28);
    const compressedStart = entry.start + 30 + localNameSize + localExtraSize;
    const compressedEnd = compressedStart + entry.compressedSize;
    if (
        zip.readUInt16LE(entry.start + 4) !== entry.version ||
        zip.readUInt32LE(entry.start + 10) !== entry.timestamp ||
        zip.readUInt16LE(entry.start + 6) !== entry.flags ||
        zip.readUInt16LE(entry.start + 8) !== entry.method ||
        localNameSize !== entry.nameBytes.length ||
        localExtraSize !== 0 ||
        !zip.subarray(entry.start + 30, entry.start + 30 + localNameSize).equals(entry.nameBytes) ||
        compressedEnd > directoryStart
    ) {
        throw new Error('ZIP local and central metadata disagree');
    }
    const hasDescriptor = (entry.flags & 8) !== 0;
    const localValues: ReadonlyArray<readonly [number, number]> = [
        [14, entry.crc],
        [18, entry.compressedSize],
        [22, entry.size],
    ];
    for (const [offset, expected] of localValues) {
        const actual = zip.readUInt32LE(entry.start + offset);
        if (actual !== expected && !(hasDescriptor && actual === 0)) {
            throw new Error('ZIP local size or CRC disagrees');
        }
    }
    const end = hasDescriptor ? descriptorEnd(zip, compressedEnd, directoryStart, entry) : compressedEnd;
    return { ...entry, compressedStart, end };
}

function readEntries(zip: Buffer, maximumMembers: number): LocalEntry[] {
    const directory = readDirectory(zip, maximumMembers);
    const entries: LocalEntry[] = [];
    let cursor = directory.start;
    let total = 0;
    for (let index = 0; index < directory.count; index++) {
        const central = readCentralEntry(zip, cursor, directory);
        const entry = readLocalEntry(zip, central, directory.start);
        total += entry.size;
        if (total > hostedWasmOutputLimit || entries.some((previous) => previous.path === entry.path)) {
            throw new Error('ZIP exceeds output bound or contains duplicate paths');
        }
        entries.push(entry);
        cursor = entry.next;
    }
    let nextStart = 0;
    for (const entry of [...entries].sort((left, right) => left.start - right.start)) {
        if (entry.start !== nextStart) {
            throw new Error('ZIP has overlapping or unaccounted member data');
        }
        nextStart = entry.end;
    }
    if (cursor !== directory.end || nextStart !== directory.start) {
        throw new Error('ZIP has unaccounted data');
    }
    return entries;
}

export function readHostedArtifactZip(zip: Buffer, maximumMembers: number): Map<string, Buffer> {
    const entries = readEntries(zip, maximumMembers);
    const files = new Map<string, Buffer>();
    for (const entry of entries) {
        const compressed = zip.subarray(entry.compressedStart, entry.compressedStart + entry.compressedSize);
        const bytes = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: entry.size + 1 });
        if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) {
            throw new Error('ZIP member actual size or CRC disagrees');
        }
        files.set(entry.path, bytes);
    }
    return files;
}
