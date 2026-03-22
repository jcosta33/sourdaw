const cache = new Map<string, AudioBuffer>();
const waveformCache = new Map<string, Float32Array>();

const DB_NAME = 'webdaw-audio';
const DB_VERSION = 1;
const STORE_NAME = 'buffers';

const openDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
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

type SerializedBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: Float32Array[];
};

function serializeBuffer(buffer: AudioBuffer): SerializedBuffer {
    const channelData: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        channelData.push(new Float32Array(buffer.getChannelData(ch)));
    }
    return { sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels, channelData };
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
        return cache.get(id);
    },

    set(id: string, buffer: AudioBuffer): void {
        cache.set(id, buffer);
        clearWaveformCachesForId(id);
        void persistToIdb(id, buffer);
    },

    remove(id: string): void {
        cache.delete(id);
        clearWaveformCachesForId(id);
        void removeFromIdb(id);
    },

    has(id: string): boolean {
        return cache.has(id);
    },

    getWaveformPeaks(id: string, numBins: number): Float32Array {
        if (numBins <= 0) {
            return new Float32Array(0);
        }

        const key = `${id}:${numBins}`;
        const cached = waveformCache.get(key);
        if (cached) {
            return cached;
        }

        const buffer = cache.get(id);
        if (!buffer) {
            return new Float32Array(numBins);
        }

        const channelData = buffer.getChannelData(0);
        const peaks = new Float32Array(numBins);
        const samplesPerBin = channelData.length / numBins;

        if (samplesPerBin >= 256) {
            // Use Mipmap Level 1
            let mipmap = mipmapLevel1Cache.get(id);
            if (!mipmap) {
                // Generate Level 1 Mipmap (256 samples per bin)
                const mipmapLength = Math.ceil(channelData.length / 256);
                mipmap = new Float32Array(mipmapLength);
                for (let i = 0; i < mipmapLength; i++) {
                    let peak = 0;
                    const start = i * 256;
                    const end = Math.min(start + 256, channelData.length);
                    for (let j = start; j < end; j++) {
                        const abs = Math.abs(channelData[j]!);
                        if (abs > peak) peak = abs;
                    }
                    mipmap[i] = peak;
                }
                mipmapLevel1Cache.set(id, mipmap);
            }

            const mipmapSamplesPerBin = mipmap.length / numBins;
            for (let bin = 0; bin < numBins; bin++) {
                let peak = 0;
                const start = Math.floor(bin * mipmapSamplesPerBin);
                const end = Math.floor(Math.min((bin + 1) * mipmapSamplesPerBin, mipmap.length));
                if (start === end) {
                    peak = mipmap[start] || 0;
                } else {
                    for (let i = start; i < end; i++) {
                        const v = mipmap[i]!;
                        if (v > peak) peak = v;
                    }
                }
                peaks[bin] = peak;
            }
        } else {
            // Use original buffer for high zoom levels
            for (let bin = 0; bin < numBins; bin++) {
                let peak = 0;
                const start = Math.floor(bin * samplesPerBin);
                const end = Math.floor(Math.min((bin + 1) * samplesPerBin, channelData.length));
                if (start === end) {
                    peak = Math.abs(channelData[start] || 0);
                } else {
                    for (let i = start; i < end; i++) {
                        const abs = Math.abs(channelData[i]!);
                        if (abs > peak) peak = abs;
                    }
                }
                peaks[bin] = peak;
            }
        }

        waveformCache.set(key, peaks);
        return peaks;
    },

    async restoreFromIdb(context: BaseAudioContext): Promise<number> {
        try {
            const db = await openDb();
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
                const req = store.getAllKeys();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });

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
                cache.set(key as string, buffer);
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
};
