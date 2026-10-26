import { DEFAULT_CACHE_LIMIT_BYTES } from '../models/StorageStatus';

import { abortWritable } from './abortWritable';
import { RENDER_CACHE_EXTENSION, RENDERS_DIRECTORY } from './storageConstants';

const RECENCY_FILE = 'recency.json';
const CACHE_LOCK = 'sourdaw:render-cache';
const CACHE_KEY = /^[a-f0-9]{64}$/;

type CacheState = {
    sizes: Map<string, number>;
    occupied: Set<string>;
    order: string[];
    totalBytes: number;
    hasUnknownDirectory: boolean;
};

function isPcmSize(size: number): boolean {
    return Number.isSafeInteger(size) && size > 0 && size % Float32Array.BYTES_PER_ELEMENT === 0;
}

async function reconcileCache(directory: FileSystemDirectoryHandle): Promise<CacheState> {
    const sizes = new Map<string, number>();
    const occupied = new Set<string>();
    const modifiedAt = new Map<string, number>();
    let totalBytes = 0;
    let hasUnknownDirectory = false;
    for await (const [name, handle] of directory) {
        occupied.add(name);
        if (handle.kind === 'directory') {
            hasUnknownDirectory = true;
            continue;
        }
        if (name === RECENCY_FILE) {
            continue;
        }
        const file = await handle.getFile();
        // Unknown files consume space but never become eviction candidates.
        totalBytes += file.size;
        const key = name.endsWith(RENDER_CACHE_EXTENSION) ? name.slice(0, -RENDER_CACHE_EXTENSION.length) : '';
        if (CACHE_KEY.test(key) && isPcmSize(file.size)) {
            sizes.set(key, file.size);
            modifiedAt.set(key, file.lastModified);
        }
    }

    let savedOrder: unknown = null;
    try {
        const handle = await directory.getFileHandle(RECENCY_FILE);
        const file = await handle.getFile();
        // Bound untrusted metadata by the largest useful index for the files that exist.
        if (file.size <= Math.max(1024, sizes.size * 67 + 1)) {
            savedOrder = JSON.parse(await file.text());
        }
    } catch {
        // Missing or corrupt metadata cannot authorize deletion; actual files own accounting.
    }
    const orderedKeys = new Set<string>();
    if (Array.isArray(savedOrder)) {
        for (const key of savedOrder) {
            if (typeof key === 'string' && sizes.has(key)) {
                orderedKeys.add(key);
            }
        }
    }
    // Upgrading or recovering a missing index retains the files' last-write order.
    const unindexedKeys = [...sizes.keys()].sort(
        (left, right) => (modifiedAt.get(left) ?? 0) - (modifiedAt.get(right) ?? 0) || left.localeCompare(right)
    );
    for (const key of unindexedKeys) {
        orderedKeys.add(key);
    }
    return { sizes, occupied, order: [...orderedKeys], totalBytes, hasUnknownDirectory };
}

async function writeFile(handle: FileSystemFileHandle, data: string | ArrayBuffer): Promise<void> {
    const writable = await handle.createWritable();
    try {
        await writable.write(data);
        await writable.close();
    } catch (error) {
        await abortWritable(writable);
        throw error;
    }
}

async function recordUse(directory: FileSystemDirectoryHandle, order: string[], cacheKey: string): Promise<void> {
    const nextOrder = [...order.filter((key) => key !== cacheKey), cacheKey];
    const handle = await directory.getFileHandle(RECENCY_FILE, { create: true });
    await writeFile(handle, JSON.stringify(nextOrder));
}

/** Cache state is disposable local storage, separate from models and project-owned audio. */
export async function accessRenderCache({
    cacheKey,
    audio,
}: {
    cacheKey: string;
    audio?: Float32Array;
}): Promise<Float32Array | null> {
    if (!CACHE_KEY.test(cacheKey)) {
        return null;
    }
    if (audio !== undefined && (!isPcmSize(audio.byteLength) || audio.byteLength > DEFAULT_CACHE_LIMIT_BYTES)) {
        return null;
    }
    const locks = globalThis.navigator?.locks;
    if (locks === undefined) {
        throw new Error('Render caching requires the Web Locks API');
    }

    return locks.request(CACHE_LOCK, { mode: 'exclusive' }, async () => {
        const root = await navigator.storage.getDirectory();
        const directory = await root.getDirectoryHandle(RENDERS_DIRECTORY, { create: audio !== undefined });
        const state = await reconcileCache(directory);
        const name = `${cacheKey}${RENDER_CACHE_EXTENSION}`;
        if (audio === undefined) {
            if (!state.sizes.has(cacheKey)) {
                return null;
            }
            const handle = await directory.getFileHandle(name);
            const buffer = await (await handle.getFile()).arrayBuffer();
            if (!isPcmSize(buffer.byteLength)) {
                return null;
            }
            const cached = new Float32Array(buffer);
            // A metadata write failure must not make otherwise valid cached audio unusable.
            try {
                await recordUse(directory, state.order, cacheKey);
            } catch {
                // The next operation reconciles the surviving index against actual files.
            }
            return cached;
        }

        // Unknown hierarchies cannot be safely measured or reclaimed by this cache.
        if (state.hasUnknownDirectory) {
            return null;
        }
        // A same-named directory or invalid PCM is not an entry this cache may replace.
        if (state.occupied.has(name) && !state.sizes.has(cacheKey)) {
            return null;
        }
        const previousSize = state.sizes.get(cacheKey) ?? 0;
        const victims = state.order.filter((key) => key !== cacheKey);
        const reclaimable = victims.reduce((sum, key) => sum + (state.sizes.get(key) ?? 0), 0);
        if (state.totalBytes - previousSize - reclaimable + audio.byteLength > DEFAULT_CACHE_LIMIT_BYTES) {
            return null;
        }
        for (const key of victims) {
            if (state.totalBytes - previousSize + audio.byteLength <= DEFAULT_CACHE_LIMIT_BYTES) {
                break;
            }
            await directory.removeEntry(`${key}${RENDER_CACHE_EXTENSION}`);
            state.totalBytes -= state.sizes.get(key) ?? 0;
            state.order = state.order.filter((entry) => entry !== key);
        }
        try {
            const handle = await directory.getFileHandle(name, { create: true });
            // Copy only this view, including when its backing buffer contains other audio.
            await writeFile(handle, new Float32Array(audio).buffer);
        } catch (error) {
            if (!state.occupied.has(name)) {
                await directory.removeEntry(name).catch(() => undefined);
            }
            throw error;
        }
        await recordUse(directory, state.order, cacheKey);
        return audio;
    });
}
