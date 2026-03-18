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

export const audioBufferCache = {
    get(id: string): AudioBuffer | undefined {
        return cache.get(id);
    },

    set(id: string, buffer: AudioBuffer): void {
        cache.set(id, buffer);
        waveformCache.delete(id);
        void persistToIdb(id, buffer);
    },

    remove(id: string): void {
        cache.delete(id);
        waveformCache.delete(id);
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
        const samplesPerBin = Math.floor(channelData.length / numBins);

        for (let bin = 0; bin < numBins; bin++) {
            let peak = 0;
            const start = bin * samplesPerBin;
            const end = Math.min(start + samplesPerBin, channelData.length);
            for (let i = start; i < end; i++) {
                const abs = Math.abs(channelData[i]!);
                if (abs > peak) {
                    peak = abs;
                }
            }
            peaks[bin] = peak;
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
