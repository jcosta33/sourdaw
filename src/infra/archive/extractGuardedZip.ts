import { unzip, unzipSync, type UnzipFileInfo } from 'fflate';

const DEFAULT_LIMITS = {
    maxEntries: 10_000,
    maxPathBytes: 255,
    maxEntryUncompressedBytes: 512 * 1024 * 1024,
    maxTotalUncompressedBytes: 2 * 1024 * 1024 * 1024,
    maxCompressionRatio: 100,
} as const;

const END_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const END_BYTES = 22;
const CENTRAL_ENTRY_BYTES = 46;
const UNIX_CREATOR = 3;
const UNIX_FILE_TYPE_MASK = 0xf000;
const UNIX_SYMLINK_TYPE = 0xa000;
const nestedArchiveExtension = /\.(?:7z|bz2|dawproject|gz|oudep|rar|tar|tgz|xz|zip)$/i;
const zipMagicSignatures = new Set([0x04034b50, 0x06054b50, 0x08074b50]);

type ZipExtractionLimits = { -readonly [Key in keyof typeof DEFAULT_LIMITS]: number };

type ExtractGuardedZipBaseInput = {
    bytes: Uint8Array;
    include?: (path: string) => boolean;
    /** Callers and tests may lower, but never raise, the production ceilings. */
    restrictLimits?: Partial<ZipExtractionLimits>;
};

type ExtractGuardedZipAsyncInput = ExtractGuardedZipBaseInput & {
    signal?: AbortSignal;
    synchronous?: false;
};

type ExtractGuardedZipSyncInput = ExtractGuardedZipBaseInput & {
    synchronous: true;
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

export function extractGuardedZip(input: ExtractGuardedZipSyncInput): Record<string, Uint8Array>;
export function extractGuardedZip(input: ExtractGuardedZipAsyncInput): Promise<Record<string, Uint8Array>>;
export function extractGuardedZip(
    input: ExtractGuardedZipSyncInput | ExtractGuardedZipAsyncInput
): Record<string, Uint8Array> | Promise<Record<string, Uint8Array>> {
    const { bytes, include = () => true, restrictLimits } = input;
    const signal = input.synchronous ? undefined : input.signal;
    let inventory: ZipInventoryEntry[];
    try {
        throwIfAborted(signal);
        const limits = resolveLimits(restrictLimits);
        rejectSymbolicLinks(bytes);
        inventory = inspectInventory(bytes, limits);
    } catch (error) {
        const failure = isAbortError(error) ? error : toZipArchiveError(error);
        if (input.synchronous) {
            throw failure;
        }
        return Promise.reject(failure);
    }

    const expected = new Map(inventory.map((entry) => [entry.path, entry]));
    const includedPaths = new Set(inventory.filter((entry) => include(entry.path)).map((entry) => entry.path));

    if (input.synchronous) {
        try {
            const result = unzipSync(bytes, {
                filter: (entry) => includedPaths.has(assertExpectedEntry(entry, expected).path),
            });
            verifyResult(result, expected, includedPaths);
            return result;
        } catch (error) {
            throw toZipArchiveError(error);
        }
    }

    return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
        let settled = false;
        let terminate = (): void => undefined;

        function finish(error?: unknown, result?: Record<string, Uint8Array>): void {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            if (error) {
                terminate();
                reject(isAbortError(error) ? error : toZipArchiveError(error));
                return;
            }
            resolve(result ?? {});
        }

        function onAbort(): void {
            finish(createAbortError());
        }

        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            terminate = unzip(
                bytes,
                {
                    filter: (entry) => {
                        const planned = assertExpectedEntry(entry, expected);
                        return includedPaths.has(planned.path);
                    },
                },
                (error, result) => {
                    if (error) {
                        finish(error);
                        return;
                    }
                    if (signal?.aborted) {
                        finish(createAbortError());
                        return;
                    }
                    try {
                        verifyResult(result, expected, includedPaths);
                        finish(undefined, result);
                    } catch (verificationError) {
                        finish(verificationError);
                    }
                }
            );
        } catch (error) {
            finish(error);
        }
    });
}

function inspectInventory(bytes: Uint8Array, limits: ZipExtractionLimits): ZipInventoryEntry[] {
    const inventory: ZipInventoryEntry[] = [];
    const paths = new Set<string>();
    let compressedBytes = 0;
    let uncompressedBytes = 0;

    unzipSync(bytes, {
        filter: (entry) => {
            if (inventory.length >= limits.maxEntries) {
                throw new Error(`ZIP entry count exceeds ${String(limits.maxEntries)}`);
            }
            validatePath(entry.name, limits.maxPathBytes);
            if (paths.has(entry.name)) {
                throw new Error(`Duplicate ZIP entry path: ${entry.name}`);
            }
            paths.add(entry.name);
            if (!entry.name.endsWith('/') && nestedArchiveExtension.test(entry.name)) {
                throw new Error(`Nested archive entries are not allowed: ${entry.name}`);
            }
            if (entry.originalSize > limits.maxEntryUncompressedBytes) {
                throw new Error(`ZIP entry exceeds the uncompressed byte limit: ${entry.name}`);
            }

            compressedBytes += entry.size;
            uncompressedBytes += entry.originalSize;
            if (uncompressedBytes > limits.maxTotalUncompressedBytes) {
                throw new Error('ZIP total uncompressed bytes exceed the archive limit');
            }
            inventory.push({
                path: entry.name,
                compressedSize: entry.size,
                uncompressedSize: entry.originalSize,
                compression: entry.compression,
            });
            return false;
        },
    });

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

function rejectSymbolicLinks(bytes: Uint8Array): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = findEndRecord(view);
    const entries = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);

    if (entries === 0xffff || offset === 0xffffffff) {
        throw new Error('ZIP64 archives are not supported');
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
        const nameBytes = view.getUint16(offset + 28, true);
        const extraBytes = view.getUint16(offset + 30, true);
        const commentBytes = view.getUint16(offset + 32, true);
        const entryBytes = CENTRAL_ENTRY_BYTES + nameBytes + extraBytes + commentBytes;
        requireAvailable(bytes, offset, entryBytes);
        offset += entryBytes;
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

function assertExpectedEntry(
    entry: UnzipFileInfo,
    expected: ReadonlyMap<string, ZipInventoryEntry>
): ZipInventoryEntry {
    const planned = expected.get(entry.name);
    if (
        !planned ||
        entry.size !== planned.compressedSize ||
        entry.originalSize !== planned.uncompressedSize ||
        entry.compression !== planned.compression
    ) {
        throw new Error(`ZIP extraction metadata does not match the inventory: ${entry.name}`);
    }
    return planned;
}

function verifyResult(
    result: Record<string, Uint8Array>,
    expected: ReadonlyMap<string, ZipInventoryEntry>,
    includedPaths: ReadonlySet<string>
): void {
    for (const [path, data] of Object.entries(result)) {
        const planned = expected.get(path);
        if (!planned || !includedPaths.has(path) || data.byteLength !== planned.uncompressedSize) {
            throw new Error(`ZIP extractor returned an unplanned entry: ${path}`);
        }
        if (data.byteLength >= 4) {
            const signature = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
            if (zipMagicSignatures.has(signature)) {
                throw new Error(`Nested archive content is not allowed: ${path}`);
            }
        }
    }
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

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw createAbortError();
    }
}

function createAbortError(): DOMException {
    return new DOMException('Aborted', 'AbortError');
}

function isAbortError(error: unknown): error is DOMException {
    return error instanceof DOMException && error.name === 'AbortError';
}

function toZipArchiveError(error: unknown): ZipArchiveError {
    if (error instanceof ZipArchiveError) {
        return error;
    }
    return new ZipArchiveError(error instanceof Error ? error.message : String(error));
}
