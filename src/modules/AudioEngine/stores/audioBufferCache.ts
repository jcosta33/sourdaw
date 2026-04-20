/** Serialized form of an AudioBuffer embedded inside a .sourdaw project file.
 * Each channel's Float32 PCM data is base64-encoded to survive JSON round-trips. */
export type ExportedAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    /** One base64-encoded Float32Array string per channel, in channel order. */
    channelData: string[];
};

async function float32ToBase64(arr: Float32Array): Promise<string> {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const CHUNK = 8192;
    const YIELD_EVERY = 32; // yield to main thread every 32 chunks (~256 KB)
    let binary = '';
    let chunkIndex = 0;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
        if (++chunkIndex % YIELD_EVERY === 0) {
            await new Promise<void>((r) => setTimeout(r, 0));
        }
    }
    return btoa(binary);
}

function base64ToFloat32(b64: string): Float32Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Float32Array(bytes.buffer);
}

// Main AudioBuffer cache — bounded to prevent OOM on sessions with many takes.
// When the cap is reached the least-recently-used buffer is evicted; it can be
// reloaded from IDB on demand. Map insertion order is used as the LRU proxy.
const MAX_AUDIO_BUFFER_ENTRIES = 64;
const cache = new Map<string, AudioBuffer>();

function audioCacheSet(id: string, buffer: AudioBuffer): void {
    // Promote existing entry to MRU position
    if (cache.has(id)) {
        cache.delete(id);
    } else if (cache.size >= MAX_AUDIO_BUFFER_ENTRIES) {
        // Evict LRU entry (first key in insertion-order Map)
        const lruKey = cache.keys().next().value;
        if (lruKey !== undefined) {
            cache.delete(lruKey);
            clearWaveformCachesForId(lruKey);
        }
    }
    cache.set(id, buffer);
}

function audioCacheGet(id: string): AudioBuffer | undefined {
    const buf = cache.get(id);
    if (buf !== undefined) {
        // Promote to MRU position
        cache.delete(id);
        cache.set(id, buf);
    }
    return buf;
}

// Waveform peak cache bounded to avoid unbounded memory growth.
// Each entry stores Float32Array peaks for a specific (bufferId, numBins) pair.
// Capped at MAX_WAVEFORM_CACHE_ENTRIES: oldest entries are evicted LRU-style.
const MAX_WAVEFORM_CACHE_ENTRIES = 256;
const waveformCache = new Map<string, Float32Array>();

function waveformCacheSet(key: string, peaks: Float32Array): void {
    if (waveformCache.size >= MAX_WAVEFORM_CACHE_ENTRIES) {
        // Evict oldest entry (Map preserves insertion order)
        const firstKey = waveformCache.keys().next().value;
        if (firstKey !== undefined) {
            waveformCache.delete(firstKey);
        }
    }
    waveformCache.set(key, peaks);
}

const DB_NAME = 'sourdaw-audio';
const DB_VERSION = 1;
const STORE_NAME = 'buffers';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

type SerializedBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: Float32Array[];
    lastAccessed: number;
    sizeInBytes: number;
};

function serializeBuffer(buffer: AudioBuffer): SerializedBuffer {
    const channelData: Float32Array[] = [];
    let sizeInBytes = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const data = new Float32Array(buffer.getChannelData(ch));
        channelData.push(data);
        sizeInBytes += data.byteLength;
    }
    return {
        sampleRate: buffer.sampleRate,
        numberOfChannels: buffer.numberOfChannels,
        channelData,
        lastAccessed: Date.now(),
        sizeInBytes,
    };
}

async function updateAccessTimeInIdb(id: string): Promise<void> {
    try {
        const db = await openDb();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => {
            const data = req.result as SerializedBuffer | undefined;
            if (data) {
                data.lastAccessed = Date.now();
                store.put(data, id);
            }
        };
    } catch {
        // ignore
    }
}

async function persistToIdb(id: string, buffer: AudioBuffer): Promise<void> {
    try {
        const db = await openDb();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(serializeBuffer(buffer), id);
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // IndexedDB unavailable
    }
}

async function removeFromIdb(id: string): Promise<void> {
    try {
        const db = await openDb();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
    } catch {
        // ignore
    }
}

const mipmapLevel1Cache = new Map<string, Float32Array>();

function clearWaveformCachesForId(id: string) {
    mipmapLevel1Cache.delete(id);
    for (const key of waveformCache.keys()) {
        if (key.startsWith(`${id}:`)) {
            waveformCache.delete(key);
        }
    }
}

export const audioBufferCache = {
    get(id: string): AudioBuffer | undefined {
        const buf = audioCacheGet(id);
        if (buf) {
            updateAccessTimeInIdb(id);
        }
        return buf;
    },

    set(id: string, buffer: AudioBuffer): void {
        audioCacheSet(id, buffer);
        clearWaveformCachesForId(id);
        persistToIdb(id, buffer);
    },

    remove(id: string): void {
        cache.delete(id);
        clearWaveformCachesForId(id);
        removeFromIdb(id);
    },

    has(id: string): boolean {
        return cache.has(id);
    },

    getWaveformPeaks(
        id: string,
        numBins: number,
        windowOpts?: { startSample?: number; endSample?: number }
    ): Float32Array {
        if (numBins <= 0) {
            return new Float32Array(0);
        }

        const buffer = cache.get(id);
        if (!buffer) {
            return new Float32Array(numBins);
        }

        updateAccessTimeInIdb(id);
        const totalSamples = buffer.length;
        const rawStart = windowOpts?.startSample ?? 0;
        const rawEnd = windowOpts?.endSample ?? totalSamples;
        const windowStart = Math.max(0, Math.min(totalSamples, Math.floor(rawStart)));
        const windowEnd = Math.max(windowStart, Math.min(totalSamples, Math.floor(rawEnd)));
        const windowLength = windowEnd - windowStart;

        // Cache key includes the window so trimmed / offset clips don't collide
        // with full-buffer peaks.
        const key = `${id}:${numBins}:${windowStart}:${windowEnd}`;
        const cached = waveformCache.get(key);
        if (cached) {
            return cached;
        }

        if (windowLength <= 0) {
            const empty = new Float32Array(numBins);
            waveformCacheSet(key, empty);
            return empty;
        }

        const channelData = buffer.getChannelData(0);
        const peaks = new Float32Array(numBins);
        const samplesPerBin = windowLength / numBins;

        if (samplesPerBin >= 256) {
            // Use Mipmap Level 1 — cached at 256-sample resolution over the
            // entire buffer. We sub-range into it by windowStart/windowEnd.
            let mipmap = mipmapLevel1Cache.get(id);
            if (!mipmap) {
                const mipmapLength = Math.ceil(channelData.length / 256);
                mipmap = new Float32Array(mipmapLength);
                for (let i = 0; i < mipmapLength; i++) {
                    let peak = 0;
                    const start = i * 256;
                    const end = Math.min(start + 256, channelData.length);
                    for (let j = start; j < end; j++) {
                        const abs = Math.abs(channelData[j]!);
                        if (abs > peak) {
                            peak = abs;
                        }
                    }
                    mipmap[i] = peak;
                }
                mipmapLevel1Cache.set(id, mipmap);
            }

            const mipmapWindowStart = windowStart / 256;
            const mipmapWindowEnd = Math.min(windowEnd / 256, mipmap.length);
            const mipmapWindowLen = Math.max(0, mipmapWindowEnd - mipmapWindowStart);
            const mipmapSamplesPerBin = mipmapWindowLen / numBins;
            for (let bin = 0; bin < numBins; bin++) {
                let peak = 0;
                const start = Math.floor(mipmapWindowStart + bin * mipmapSamplesPerBin);
                const end = Math.floor(Math.min(mipmapWindowStart + (bin + 1) * mipmapSamplesPerBin, mipmap.length));
                if (start === end) {
                    peak = mipmap[start] || 0;
                } else {
                    for (let i = start; i < end; i++) {
                        const v = mipmap[i]!;
                        if (v > peak) {
                            peak = v;
                        }
                    }
                }
                peaks[bin] = peak;
            }
        } else {
            // High zoom: read directly from the windowed portion of the buffer.
            for (let bin = 0; bin < numBins; bin++) {
                let peak = 0;
                const start = Math.floor(windowStart + bin * samplesPerBin);
                const end = Math.floor(Math.min(windowStart + (bin + 1) * samplesPerBin, windowEnd));
                if (start === end) {
                    peak = Math.abs(channelData[start] || 0);
                } else {
                    for (let i = start; i < end; i++) {
                        const abs = Math.abs(channelData[i]!);
                        if (abs > peak) {
                            peak = abs;
                        }
                    }
                }
                peaks[bin] = peak;
            }
        }

        waveformCacheSet(key, peaks);
        return peaks;
    },

    async restoreFromIdb(context: BaseAudioContext, ids?: string[]): Promise<number> {
        try {
            const db = await openDb();
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);

            // When the caller supplies a list of IDs (e.g. the buffer IDs referenced
            // by the current project's clips), load only those — skipping unrelated
            // takes and imported samples that are not needed for this session.
            // Without IDs, fall back to loading all keys (legacy / startup path).
            let keys: IDBValidKey[];
            if (ids && ids.length > 0) {
                keys = ids.filter((id) => !cache.has(id));
            } else {
                keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
                    const req = store.getAllKeys();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            }

            let restored = 0;
            for (const key of keys) {
                if (cache.has(key as string)) {
                    continue;
                }
                const data = await new Promise<SerializedBuffer | undefined>((resolve, reject) => {
                    const req = store.get(key);
                    req.onsuccess = () => resolve(req.result as SerializedBuffer | undefined);
                    req.onerror = () => reject(req.error);
                });
                if (!data) {
                    continue;
                }
                const length = data.channelData[0]?.length ?? 0;
                if (length === 0) {
                    continue;
                }
                const buffer = context.createBuffer(data.numberOfChannels, length, data.sampleRate);
                for (let ch = 0; ch < data.numberOfChannels; ch++) {
                    const src = data.channelData[ch]!;
                    buffer.getChannelData(ch).set(src);
                }
                audioCacheSet(key as string, buffer);
                restored++;
            }
            return restored;
        } catch {
            return 0;
        }
    },

    clear(): void {
        cache.clear();
        waveformCache.clear();
        openDb()
            .then((db) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).clear();
            })
            .catch(() => {
                /* ignore */
            });
    },

    /** Serialize the given buffer IDs to base64-encoded PCM for embedding in a
     * .sourdaw project file. IDs not found in the in-memory cache are fetched
     * from IDB before serialization. IDs that cannot be resolved are silently
     * omitted from the result. */
    async exportBuffers(ids: string[]): Promise<Record<string, ExportedAudioBuffer>> {
        const result: Record<string, ExportedAudioBuffer> = {};

        // Pass 1: serialize buffers already in the in-memory cache
        for (const id of ids) {
            const buf = cache.get(id);
            if (!buf) {
                continue;
            }
            updateAccessTimeInIdb(id);
            result[id] = {
                sampleRate: buf.sampleRate,
                numberOfChannels: buf.numberOfChannels,
                channelData: await Promise.all(
                    Array.from({ length: buf.numberOfChannels }, (_, ch) =>
                        float32ToBase64(new Float32Array(buf.getChannelData(ch)))
                    )
                ),
            };
        }

        // Pass 2: for IDs evicted from the LRU cache, read SerializedBuffer
        // directly from IDB and encode without reconstructing an AudioBuffer
        // (which would require an AudioContext we may not have here).
        const missingIds = ids.filter((id) => !(id in result));
        if (missingIds.length > 0) {
            try {
                const db = await openDb();
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                for (const id of missingIds) {
                    const data = await new Promise<SerializedBuffer | undefined>((resolve, reject) => {
                        const req = store.get(id);
                        req.onsuccess = () => resolve(req.result as SerializedBuffer | undefined);
                        req.onerror = () => reject(req.error);
                    });
                    if (!data || (data.channelData[0]?.length ?? 0) === 0) {
                        continue;
                    }
                    updateAccessTimeInIdb(id);
                    result[id] = {
                        sampleRate: data.sampleRate,
                        numberOfChannels: data.numberOfChannels,
                        channelData: await Promise.all(data.channelData.map(float32ToBase64)),
                    };
                }
            } catch {
                // IDB unavailable — those IDs remain absent from the result
            }
        }

        return result;
    },

    /** Reconstruct AudioBuffer objects from base64-encoded data embedded in a
     * .sourdaw project file, loading them into both the in-memory cache and IDB.
     * Buffers whose ID already exists in the cache are skipped. */
    async importBuffers(buffers: Record<string, ExportedAudioBuffer>, context: BaseAudioContext): Promise<void> {
        for (const [id, data] of Object.entries(buffers)) {
            if (cache.has(id)) {
                continue;
            }
            try {
                const channels = data.channelData.map(base64ToFloat32);
                const length = channels[0]?.length ?? 0;
                if (length === 0) {
                    continue;
                }
                const buffer = context.createBuffer(data.numberOfChannels, length, data.sampleRate);
                for (let ch = 0; ch < data.numberOfChannels; ch++) {
                    buffer.getChannelData(ch).set(channels[ch]!);
                }
                clearWaveformCachesForId(id);
                audioCacheSet(id, buffer);
                persistToIdb(id, buffer);
            } catch {
                // Skip any malformed entry
            }
        }
    },

    async garbageCollectFreezeFiles(activeIds: Set<string>): Promise<void> {
        // Remove from memory cache
        for (const key of cache.keys()) {
            if (key.startsWith('freeze-') && !activeIds.has(key)) {
                cache.delete(key);
                clearWaveformCachesForId(key);
            }
        }

        // Remove from IndexedDB
        try {
            const db = await openDb();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAllKeys();
            req.onsuccess = () => {
                const keys = req.result as string[];
                for (const key of keys) {
                    if (key.startsWith('freeze-') && !activeIds.has(key)) {
                        store.delete(key);
                    }
                }
            };
        } catch {
            // Ignore IDB errors
        }
    },

    async garbageCollectByAge(maxAgeDays: number): Promise<number> {
        const threshold = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
        let deletedCount = 0;
        try {
            const db = await openDb();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            const keysReq = store.getAllKeys();

            const [data, keys] = await Promise.all([
                new Promise<SerializedBuffer[]>((resolve) => (req.onsuccess = () => resolve(req.result))),
                new Promise<IDBValidKey[]>((resolve) => (keysReq.onsuccess = () => resolve(keysReq.result))),
            ]);

            for (let i = 0; i < data.length; i++) {
                const item = data[i]!;
                const key = keys[i]! as string;
                if ((item.lastAccessed ?? 0) < threshold) {
                    store.delete(key);
                    cache.delete(key);
                    clearWaveformCachesForId(key);
                    deletedCount++;
                }
            }
        } catch {
            /* ignore */
        }
        return deletedCount;
    },

    async garbageCollectBySize(maxSizeBytes: number): Promise<number> {
        let deletedCount = 0;
        try {
            const db = await openDb();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            const keysReq = store.getAllKeys();

            const [data, keys] = await Promise.all([
                new Promise<SerializedBuffer[]>((resolve) => (req.onsuccess = () => resolve(req.result))),
                new Promise<IDBValidKey[]>((resolve) => (keysReq.onsuccess = () => resolve(keysReq.result))),
            ]);

            // Sort by access time ascending (oldest first)
            const entries = data
                .map((item, i) => ({
                    id: keys[i]! as string,
                    lastAccessed: item.lastAccessed ?? 0,
                    size: item.sizeInBytes ?? 0,
                }))
                .sort((a, b) => a.lastAccessed - b.lastAccessed);

            let currentTotal = entries.reduce((acc, e) => acc + e.size, 0);

            for (const entry of entries) {
                if (currentTotal <= maxSizeBytes) {
                    break;
                }
                store.delete(entry.id);
                cache.delete(entry.id);
                clearWaveformCachesForId(entry.id);
                currentTotal -= entry.size;
                deletedCount++;
            }
        } catch {
            /* ignore */
        }
        return deletedCount;
    },
};
