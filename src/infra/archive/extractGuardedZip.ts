import { strFromU8, Unzip, UnzipInflate, type UnzipFile } from 'fflate';

const DEFAULT_LIMITS = {
    maxEntries: 10_000,
    maxPathBytes: 255,
    maxEntryUncompressedBytes: 512 * 1024 * 1024,
    maxTotalUncompressedBytes: 2 * 1024 * 1024 * 1024,
    maxCompressionRatio: 100,
} as const;

const END_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_ENTRY_SIGNATURE = 0x04034b50;
const END_BYTES = 22;
const CENTRAL_ENTRY_BYTES = 46;
const LOCAL_ENTRY_BYTES = 30;
const UNIX_CREATOR = 3;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_SYMLINK_TYPE = 0xa000;
const nestedArchiveExtension = /\.(?:7z|bz2|dawproject|gz|oudep|rar|tar|tgz|xz|zip)$/i;
const STREAM_CHUNK_BYTES = 4096;

type ZipExtractionLimits = { -readonly [Key in keyof typeof DEFAULT_LIMITS]: number };

type ExtractGuardedZipInput = {
    bytes: Uint8Array;
    include?: (path: string) => boolean;
    /** Callers and tests may lower, but never raise, the production ceilings. */
    restrictLimits?: Partial<ZipExtractionLimits>;
};

type ZipInventoryEntry = {
    path: string;
    compressedSize: number;
    uncompressedSize: number;
    compression: number;
};

export class ZipArchiveError extends Error {
    override readonly name = 'ZipArchiveError';
}

export function extractGuardedZip(input: ExtractGuardedZipInput): Record<string, Uint8Array> {
    const { bytes, include = () => true, restrictLimits } = input;
    try {
        const limits = resolveLimits(restrictLimits);
        const inventory = inspectInventory(bytes, limits);
        const expected = new Map(inventory.map((entry) => [entry.path, entry]));
        const included = new Set(inventory.filter((entry) => include(entry.path)).map((entry) => entry.path));
        const extraction = createStreamingExtraction(expected, included, limits);
        for (let offset = 0; offset < bytes.byteLength && !extraction.failed(); offset += STREAM_CHUNK_BYTES) {
            const end = Math.min(offset + STREAM_CHUNK_BYTES, bytes.byteLength);
            extraction.push(bytes.subarray(offset, end), end === bytes.byteLength);
        }
        return extraction.finish();
    } catch (error) {
        throw toZipArchiveError(error);
    }
}

function inspectInventory(bytes: Uint8Array, limits: ZipExtractionLimits): ZipInventoryEntry[] {
    const inventory = readCentralDirectory(bytes);
    const paths = new Set<string>();
    let compressedBytes = 0;
    let uncompressedBytes = 0;

    if (inventory.length > limits.maxEntries) {
        throw new Error(`ZIP entry count exceeds ${String(limits.maxEntries)}`);
    }
    for (const entry of inventory) {
        validatePath(entry.path, limits.maxPathBytes);
        if (paths.has(entry.path)) {
            throw new Error(`Duplicate ZIP entry path: ${entry.path}`);
        }
        paths.add(entry.path);
        if (!entry.path.endsWith('/') && nestedArchiveExtension.test(entry.path)) {
            throw new Error(`Nested archive entries are not allowed: ${entry.path}`);
        }
        if (entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
            throw new Error(`ZIP entry exceeds the uncompressed byte limit: ${entry.path}`);
        }
        compressedBytes += entry.compressedSize;
        uncompressedBytes += entry.uncompressedSize;
        if (uncompressedBytes > limits.maxTotalUncompressedBytes) {
            throw new Error('ZIP total uncompressed bytes exceed the archive limit');
        }
    }

    let ratio = 0;
    if (compressedBytes === 0 && uncompressedBytes > 0) {
        ratio = Infinity;
    } else if (compressedBytes > 0) {
        ratio = uncompressedBytes / compressedBytes;
    }
    if (ratio > limits.maxCompressionRatio) {
        throw new Error(`ZIP compression ratio exceeds ${String(limits.maxCompressionRatio)}:1`);
    }
    return inventory;
}

function readCentralDirectory(bytes: Uint8Array): ZipInventoryEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = findEndRecord(view);
    const entriesOnDisk = view.getUint16(end + 8, true);
    const entries = view.getUint16(end + 10, true);
    const centralBytes = view.getUint32(end + 12, true);
    let offset = view.getUint32(end + 16, true);
    const centralEnd = offset + centralBytes;
    const inventory: ZipInventoryEntry[] = [];

    if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 || entriesOnDisk !== entries) {
        throw new Error('ZIP entry counts or disk fields are inconsistent');
    }
    if (entries === 0xffff || centralBytes === 0xffffffff || offset === 0xffffffff) {
        throw new Error('ZIP64 archives are not supported');
    }
    if (centralEnd !== end) {
        throw new Error('ZIP central directory bounds are inconsistent');
    }
    for (let index = 0; index < entries; index += 1) {
        requireAvailable(bytes, offset, CENTRAL_ENTRY_BYTES);
        if (view.getUint32(offset, true) !== CENTRAL_ENTRY_SIGNATURE) {
            throw new Error('ZIP central directory entry signature is invalid');
        }
        const creator = view.getUint16(offset + 4, true) >>> 8;
        const unixMode = view.getUint32(offset + 38, true) >>> 16;
        if (creator === UNIX_CREATOR && (unixMode & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK_TYPE) {
            throw new Error('ZIP symbolic links are not allowed');
        }
        const flags = view.getUint16(offset + 8, true);
        if ((flags & 1) !== 0) {
            throw new Error('ZIP encrypted entries are not allowed');
        }
        const nameBytes = view.getUint16(offset + 28, true);
        const extraBytes = view.getUint16(offset + 30, true);
        const commentBytes = view.getUint16(offset + 32, true);
        const entryBytes = CENTRAL_ENTRY_BYTES + nameBytes + extraBytes + commentBytes;
        requireAvailable(bytes, offset, entryBytes);
        const nameData = bytes.subarray(offset + CENTRAL_ENTRY_BYTES, offset + CENTRAL_ENTRY_BYTES + nameBytes);
        const path = strFromU8(nameData, (flags & 0x800) === 0);
        const localOffset = view.getUint32(offset + 42, true);
        validateLocalHeader(bytes, view, localOffset, flags, view.getUint16(offset + 10, true), nameData);
        inventory.push({
            path,
            compressedSize: view.getUint32(offset + 20, true),
            uncompressedSize: view.getUint32(offset + 24, true),
            compression: view.getUint16(offset + 10, true),
        });
        offset += entryBytes;
    }
    if (offset !== centralEnd) {
        throw new Error('ZIP central directory entry count is inconsistent');
    }
    return inventory;
}

function validateLocalHeader(
    bytes: Uint8Array,
    view: DataView,
    offset: number,
    flags: number,
    compression: number,
    centralName: Uint8Array
): void {
    requireAvailable(bytes, offset, LOCAL_ENTRY_BYTES);
    if (view.getUint32(offset, true) !== LOCAL_ENTRY_SIGNATURE) {
        throw new Error('ZIP local entry signature is invalid');
    }
    if (view.getUint16(offset + 6, true) !== flags || view.getUint16(offset + 8, true) !== compression) {
        throw new Error('ZIP local and central entry metadata disagree');
    }
    if ((flags & 8) !== 0) {
        throw new Error('ZIP data-descriptor entries are not supported');
    }
    const nameBytes = view.getUint16(offset + 26, true);
    requireAvailable(bytes, offset + LOCAL_ENTRY_BYTES, nameBytes + view.getUint16(offset + 28, true));
    const localName = bytes.subarray(offset + LOCAL_ENTRY_BYTES, offset + LOCAL_ENTRY_BYTES + nameBytes);
    if (nameBytes !== centralName.byteLength || localName.some((byte, index) => byte !== centralName[index])) {
        throw new Error('ZIP local and central entry names disagree');
    }
}

function findEndRecord(view: DataView): number {
    const first = view.byteLength - END_BYTES;
    const last = Math.max(0, first - 65_535);
    for (let offset = first; offset >= last; offset -= 1) {
        if (view.getUint32(offset, true) !== END_SIGNATURE) {
            continue;
        }
        const commentBytes = view.getUint16(offset + 20, true);
        if (offset + END_BYTES + commentBytes === view.byteLength) {
            return offset;
        }
    }
    throw new Error('Input is not a supported ZIP archive');
}

function requireAvailable(bytes: Uint8Array, offset: number, length: number): void {
    if (offset < 0 || length < 0 || offset > bytes.byteLength || length > bytes.byteLength - offset) {
        throw new Error('ZIP entry extends beyond the archive bounds');
    }
}

function validatePath(path: string, maxPathBytes: number): void {
    const pathBytes = new TextEncoder().encode(path).byteLength;
    if (pathBytes === 0 || pathBytes > maxPathBytes) {
        throw new Error(`Unsafe archive path length: ${path}`);
    }
    if (path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
        throw new Error(`Unsafe archive path: ${path}`);
    }
    const parts = path.endsWith('/') ? path.slice(0, -1).split('/') : path.split('/');
    if (parts.length === 0 || parts.some((part) => part === '' || part === '.' || part === '..')) {
        throw new Error(`Unsafe archive path: ${path}`);
    }
}

function assertExpectedEntry(entry: UnzipFile, expected: ReadonlyMap<string, ZipInventoryEntry>): ZipInventoryEntry {
    const planned = expected.get(entry.name);
    if (
        !planned ||
        (entry.size !== undefined && entry.size !== planned.compressedSize) ||
        (entry.originalSize !== undefined && entry.originalSize !== planned.uncompressedSize) ||
        entry.compression !== planned.compression
    ) {
        throw new Error(`ZIP extraction metadata does not match the inventory: ${entry.name}`);
    }
    return planned;
}

function createStreamingExtraction(
    expected: ReadonlyMap<string, ZipInventoryEntry>,
    includedPaths: ReadonlySet<string>,
    limits: ZipExtractionLimits
) {
    const result: Record<string, Uint8Array> = {};
    let completed = 0;
    let expandedBytes = 0;
    let failure: unknown;
    const unzipper = new Unzip((file) => {
        try {
            const planned = assertExpectedEntry(file, expected);
            if (!includedPaths.has(planned.path)) {
                return;
            }
            const output = new Uint8Array(planned.uncompressedSize);
            let written = 0;
            file.ondata = (error, data, final) => {
                if (failure) {
                    return;
                }
                if (error) {
                    failure = error;
                    return;
                }
                if (written + data.byteLength > output.byteLength) {
                    failure = new Error(`ZIP entry exceeds its declared size: ${planned.path}`);
                    return;
                }
                expandedBytes += data.byteLength;
                if (expandedBytes > limits.maxTotalUncompressedBytes) {
                    failure = new Error('ZIP total expanded bytes exceed the archive limit');
                    return;
                }
                output.set(data, written);
                written += data.byteLength;
                if (!final) {
                    return;
                }
                if (written !== output.byteLength) {
                    failure = new Error(`ZIP entry does not match its declared size: ${planned.path}`);
                    return;
                }
                if (hasNestedArchiveMagic(output)) {
                    failure = new Error(`Nested archive content is not allowed: ${planned.path}`);
                    return;
                }
                result[planned.path] = output;
                completed += 1;
            };
            file.start();
        } catch (error) {
            failure = error;
        }
    });
    unzipper.register(UnzipInflate);
    return {
        failed: () => failure !== undefined,
        push: (chunk: Uint8Array, final: boolean) => {
            if (!failure) {
                try {
                    unzipper.push(chunk, final);
                } catch (error) {
                    failure = error;
                }
            }
        },
        finish: () => {
            if (!failure && completed !== includedPaths.size) {
                failure = new Error('ZIP extraction did not produce every selected entry');
            }
            if (failure) {
                throw toZipArchiveError(failure);
            }
            return result;
        },
    };
}

function hasNestedArchiveMagic(data: Uint8Array): boolean {
    if (data.byteLength >= END_BYTES) {
        try {
            readCentralDirectory(data);
            return true;
        } catch (error) {
            if (error instanceof Error && error.message !== 'Input is not a supported ZIP archive') {
                return true;
            }
        }
    }
    if (
        startsWith(data, [0x1f, 0x8b]) ||
        startsWith(data, [0x42, 0x5a, 0x68]) ||
        startsWith(data, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) ||
        startsWith(data, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) ||
        startsWith(data, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) ||
        startsWith(data.subarray(257), [0x75, 0x73, 0x74, 0x61, 0x72])
    ) {
        return true;
    }
    return false;
}

function startsWith(data: Uint8Array, signature: readonly number[]): boolean {
    return signature.every((byte, index) => data[index] === byte);
}

function resolveLimits(restrictions?: Partial<ZipExtractionLimits>): ZipExtractionLimits {
    const result = { ...DEFAULT_LIMITS } as ZipExtractionLimits;
    for (const key of Object.keys(DEFAULT_LIMITS) as (keyof ZipExtractionLimits)[]) {
        const requested = restrictions?.[key];
        if (requested === undefined) {
            continue;
        }
        if (!Number.isFinite(requested) || requested <= 0) {
            throw new Error(`Invalid ZIP restriction: ${key}`);
        }
        result[key] = Math.min(result[key], requested);
    }
    return result;
}

function toZipArchiveError(error: unknown): ZipArchiveError {
    if (error instanceof ZipArchiveError) {
        return error;
    }
    return new ZipArchiveError(error instanceof Error ? error.message : String(error));
}
