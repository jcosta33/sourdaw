import { logger } from '#/infra/logger/appLogger';

import { fetchAndDecode } from './fetchAndDecode';
import {
    parseSampleManifest,
    type ManifestLegatoTransition,
    type ManifestZone,
    type SampleManifest,
} from './sampleManifest';

import type { SampleLodConfig } from './helpers';

export type DecodedSample = {
    data: Float32Array<SharedArrayBuffer>;
    frameCount: number;
    channels: number;
    sampleRate: number;
};

export type DecodedBankZone = {
    zone: ManifestZone;
    articulationId: number;
};

export type DecodedBank = {
    bankKey: string;
    version: number;
    instrumentId: string;
    files: readonly string[];
    samples: ReadonlyMap<string, DecodedSample>;
    zones: readonly DecodedBankZone[];
    /**
     * Recorded interval samples, if the bank authors any. Their files are
     * decoded alongside the zone files so the engine can be told about them
     * before it needs them.
     */
    legatoTransitions: readonly ManifestLegatoTransition[];
    numArticulations: number;
    numMics: number;
    decodedByteLength: number;
};

export type DecodedBankLease = {
    /** The bank remains physically accounted and non-evictable until `release` is called. */
    bank: DecodedBank;
    /** Idempotently ends this consumer's ownership of the decoded PCM. */
    release: () => void;
};

export type LoadDecodedBankInput = {
    manifestUrl: string;
    basePath: string;
    expectedInstrumentId: string;
    lod: SampleLodConfig;
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
};

export type DecodedBankResourceDiagnostics = {
    cacheHits: number;
    cacheMisses: number;
    manifestLoads: number;
    sampleLoads: number;
    sampleLoadFailures: number;
    failedBanks: number;
    evictions: number;
    resolvedBanks: number;
    inFlightBanks: number;
    decodedBytes: number;
    activeLeases: number;
    activeSampleLoads: number;
    queuedSampleLoads: number;
};

export type DecodedBankResource = {
    acquire: (input: LoadDecodedBankInput) => Promise<DecodedBankLease>;
    invalidate: (
        input: Pick<LoadDecodedBankInput, 'basePath' | 'expectedInstrumentId' | 'lod' | 'manifestUrl'>
    ) => void;
    clear: () => void;
    getDiagnostics: () => DecodedBankResourceDiagnostics;
};

type CreateDecodedBankResourceInput = {
    maxDecodedBytes?: number;
    maxConcurrentSampleLoads?: number;
    loadManifest?: (url: string, signal: AbortSignal) => Promise<SampleManifest>;
    loadSample?: (url: string, signal: AbortSignal) => Promise<DecodedSample>;
};

type BankEntry = {
    key: string;
    publicationKey: string;
    baseKey: string;
    consumerController: AbortController;
    controller: AbortController;
    consumers: Set<symbol>;
    activeLeases: number;
    decodedBytes: number;
    lastAccess: number;
    listeners: Map<symbol, (progress: number) => void>;
    progress: number;
    promise: Promise<DecodedBank> | null;
    samples: Map<string, DecodedSample>;
    retired: boolean;
    state: 'loading' | 'resolved';
};

let bankPublicationSequence = 0;

function allocateBankPublicationKey(cacheKey: string): string {
    if (bankPublicationSequence >= Number.MAX_SAFE_INTEGER) {
        throw new Error('Levain decoded-bank publication key capacity exhausted');
    }
    bankPublicationSequence += 1;
    return `${cacheKey}\u0000${bankPublicationSequence}`;
}

type ManifestEntry = {
    controller: AbortController;
    consumers: Set<symbol>;
    promise: Promise<SampleManifest>;
};

type SampleTask = {
    run: () => Promise<DecodedSample>;
    resolve: (sample: DecodedSample) => void;
    reject: (error: unknown) => void;
    signal: AbortSignal;
};

const DEFAULT_MAX_DECODED_BYTES = 384 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_SAMPLE_LOADS = 4;

function createAbortError(): DOMException {
    return new DOMException('Levain bank load aborted', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw createAbortError();
    }
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    return new Error(String(error));
}

function createCacheBaseKey(
    input: Pick<LoadDecodedBankInput, 'basePath' | 'expectedInstrumentId' | 'lod' | 'manifestUrl'>
): string {
    return [
        input.manifestUrl,
        input.basePath,
        input.expectedInstrumentId,
        input.lod.maxMics.toString(),
        input.lod.maxRoundRobins.toString(),
    ].join('\u0000');
}

function createCacheKey(baseKey: string, manifest: SampleManifest): string {
    return [baseKey, manifest.instrumentId, manifest.version.toString()].join('\u0000');
}

function encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
}

async function loadManifestFromNetwork(url: string, signal: AbortSignal): Promise<SampleManifest> {
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${url} (${response.status})`);
    }
    return parseSampleManifest(await response.json());
}

export function createDecodedBankResource({
    maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES,
    maxConcurrentSampleLoads = DEFAULT_MAX_CONCURRENT_SAMPLE_LOADS,
    loadManifest = loadManifestFromNetwork,
    loadSample = fetchAndDecode,
}: CreateDecodedBankResourceInput = {}): DecodedBankResource {
    if (!Number.isFinite(maxDecodedBytes) || maxDecodedBytes <= 0) {
        throw new RangeError('maxDecodedBytes must be greater than zero');
    }
    if (!Number.isInteger(maxConcurrentSampleLoads) || maxConcurrentSampleLoads <= 0) {
        throw new RangeError('maxConcurrentSampleLoads must be a positive integer');
    }

    const entries = new Map<string, BankEntry>();
    const currentBankKeys = new Map<string, string>();
    const manifestEntries = new Map<string, ManifestEntry>();
    const baseEpochs = new Map<string, number>();
    const pendingManifestConsumers = new Map<string, Set<AbortController>>();
    const sampleQueue: SampleTask[] = [];
    let sampleQueueHead = 0;
    let clearEpoch = 0;
    let activeSampleLoads = 0;
    let activeLeases = 0;
    let decodedBytes = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    let manifestLoads = 0;
    let sampleLoads = 0;
    let sampleLoadFailures = 0;
    let failedBanks = 0;
    let evictions = 0;
    let accessSequence = 0;

    function createManifestEntry(manifestUrl: string): ManifestEntry {
        const controller = new AbortController();
        manifestLoads++;
        let promise: Promise<SampleManifest>;
        try {
            promise = loadManifest(manifestUrl, controller.signal);
        } catch (error) {
            promise = Promise.reject(normalizeError(error));
        }
        const entry: ManifestEntry = { controller, consumers: new Set(), promise };
        void promise.then(
            () => {
                if (manifestEntries.get(manifestUrl) === entry) {
                    manifestEntries.delete(manifestUrl);
                }
                return undefined;
            },
            () => {
                if (manifestEntries.get(manifestUrl) === entry) {
                    manifestEntries.delete(manifestUrl);
                }
                return undefined;
            }
        );
        return entry;
    }

    function consumeManifest(
        entry: ManifestEntry,
        manifestUrl: string,
        consumerSignals: readonly AbortSignal[]
    ): Promise<SampleManifest> {
        const token = Symbol('Levain manifest consumer');
        entry.consumers.add(token);
        return new Promise((resolve, reject) => {
            let settled = false;

            function release(): void {
                for (const signal of consumerSignals) {
                    signal.removeEventListener('abort', onAbort);
                }
                entry.controller.signal.removeEventListener('abort', onAbort);
                entry.consumers.delete(token);
                if (entry.consumers.size === 0 && manifestEntries.get(manifestUrl) === entry) {
                    manifestEntries.delete(manifestUrl);
                    entry.controller.abort();
                }
            }

            function onAbort(): void {
                if (settled) {
                    return;
                }
                settled = true;
                release();
                reject(createAbortError());
            }

            for (const signal of consumerSignals) {
                signal.addEventListener('abort', onAbort, { once: true });
            }
            entry.controller.signal.addEventListener('abort', onAbort, { once: true });
            if (consumerSignals.some((signal) => signal.aborted) || entry.controller.signal.aborted) {
                onAbort();
            }
            void entry.promise.then(
                (manifest) => {
                    if (!settled) {
                        settled = true;
                        release();
                        resolve(manifest);
                    }
                    return undefined;
                },
                (error: unknown) => {
                    if (!settled) {
                        settled = true;
                        release();
                        reject(normalizeError(error));
                    }
                    return undefined;
                }
            );
        });
    }

    async function loadValidatedManifest(
        input: LoadDecodedBankInput,
        resourceSignal: AbortSignal
    ): Promise<SampleManifest> {
        let entry = manifestEntries.get(input.manifestUrl);
        if (!entry) {
            entry = createManifestEntry(input.manifestUrl);
            manifestEntries.set(input.manifestUrl, entry);
        }
        const consumerSignals = input.signal ? [input.signal, resourceSignal] : [resourceSignal];
        const manifest = await consumeManifest(entry, input.manifestUrl, consumerSignals);
        if (manifest.instrumentId !== input.expectedInstrumentId) {
            throw new TypeError(
                `Levain manifest instrument ${manifest.instrumentId} does not match requested ${input.expectedInstrumentId}`
            );
        }
        return manifest;
    }

    function notifyListener(
        entry: BankEntry,
        token: symbol,
        listener: (progress: number) => void,
        progress: number
    ): void {
        try {
            listener(progress);
        } catch (error) {
            entry.listeners.delete(token);
            logger.warn('Levain decoded-bank progress listener failed:', error);
        }
    }

    function registerPendingManifestConsumer(baseKey: string): AbortController {
        const controller = new AbortController();
        const consumers = pendingManifestConsumers.get(baseKey) ?? new Set<AbortController>();
        consumers.add(controller);
        pendingManifestConsumers.set(baseKey, consumers);
        return controller;
    }

    function releasePendingManifestConsumer(baseKey: string, controller: AbortController): void {
        const consumers = pendingManifestConsumers.get(baseKey);
        if (!consumers) {
            return;
        }
        consumers.delete(controller);
        if (consumers.size === 0) {
            pendingManifestConsumers.delete(baseKey);
        }
    }

    function notifyProgress(entry: BankEntry, progress: number): void {
        entry.progress = progress;
        for (const [token, listener] of entry.listeners) {
            notifyListener(entry, token, listener, progress);
        }
    }

    function drainSampleQueue(): void {
        while (activeSampleLoads < maxConcurrentSampleLoads) {
            const task = sampleQueue[sampleQueueHead];
            if (!task) {
                return;
            }
            sampleQueueHead++;
            if (sampleQueueHead === sampleQueue.length) {
                sampleQueue.length = 0;
                sampleQueueHead = 0;
            }
            if (task.signal.aborted) {
                task.reject(createAbortError());
                continue;
            }

            activeSampleLoads++;
            sampleLoads++;
            let samplePromise: Promise<DecodedSample>;
            try {
                samplePromise = task.run();
            } catch (error) {
                activeSampleLoads--;
                sampleLoadFailures++;
                task.reject(error);
                continue;
            }
            void samplePromise
                .then(task.resolve, (error: unknown) => {
                    sampleLoadFailures++;
                    task.reject(error);
                })
                .finally(() => {
                    activeSampleLoads--;
                    drainSampleQueue();
                });
        }
    }

    function scheduleSampleLoad({ signal, url }: { signal: AbortSignal; url: string }): Promise<DecodedSample> {
        return new Promise((resolve, reject) => {
            sampleQueue.push({
                run: () => loadSample(url, signal),
                resolve,
                reject,
                signal,
            });
            drainSampleQueue();
        });
    }

    function releaseDecodedBytes(entry: BankEntry): void {
        decodedBytes -= entry.decodedBytes;
        entry.decodedBytes = 0;
    }

    function releaseRetiredEntry(entry: BankEntry): void {
        if (!entry.retired || entry.activeLeases > 0) {
            return;
        }
        entry.samples.clear();
        releaseDecodedBytes(entry);
    }

    function removeEntry({
        entry,
        key,
        recordEviction = false,
        notifyConsumers = true,
    }: {
        entry: BankEntry;
        key: string;
        recordEviction?: boolean;
        notifyConsumers?: boolean;
    }): void {
        const ownsCacheSlot = entries.get(key) === entry;
        if (ownsCacheSlot) {
            entries.delete(key);
        }
        if (ownsCacheSlot && currentBankKeys.get(entry.baseKey) === key) {
            currentBankKeys.delete(entry.baseKey);
        }
        if (notifyConsumers) {
            entry.consumerController.abort();
        }
        if (entry.state === 'loading') {
            entry.controller.abort();
            entry.samples.clear();
            releaseDecodedBytes(entry);
            return;
        }
        if (recordEviction) {
            evictions++;
        }
        entry.retired = true;
        releaseRetiredEntry(entry);
    }

    function makeRoomFor(entry: BankEntry, additionalBytes: number): void {
        while (decodedBytes + additionalBytes > maxDecodedBytes) {
            let evictionCandidate: { key: string; entry: BankEntry } | null = null;
            for (const [key, candidate] of entries) {
                if (
                    candidate === entry ||
                    candidate.activeLeases > 0 ||
                    candidate.consumers.size > 0 ||
                    candidate.decodedBytes === 0 ||
                    candidate.lastAccess >= entry.lastAccess
                ) {
                    continue;
                }
                if (!evictionCandidate || candidate.lastAccess < evictionCandidate.entry.lastAccess) {
                    evictionCandidate = { key, entry: candidate };
                }
            }
            if (!evictionCandidate) {
                throw new RangeError('Levain decoded-bank memory budget exceeded');
            }
            removeEntry({
                entry: evictionCandidate.entry,
                key: evictionCandidate.key,
                recordEviction: true,
            });
        }
    }

    function reserveDecodedSample(entry: BankEntry, sample: DecodedSample): void {
        const sampleBytes = sample.data.byteLength;
        makeRoomFor(entry, sampleBytes);
        entry.decodedBytes += sampleBytes;
        decodedBytes += sampleBytes;
    }

    async function decodeBank({
        controller,
        entry,
        input,
        manifest,
    }: {
        controller: AbortController;
        entry: BankEntry;
        input: LoadDecodedBankInput;
        manifest: SampleManifest;
    }): Promise<DecodedBank> {
        if (controller.signal.aborted) {
            throw createAbortError();
        }

        const zones: DecodedBankZone[] = [];
        let numArticulations = 0;
        let numMics = manifest.micPositions.length;
        for (const articulation of manifest.articulations) {
            numArticulations = Math.max(numArticulations, articulation.id + 1);
            for (const zone of articulation.zones) {
                if (input.lod.maxMics > 0 && zone.micId >= input.lod.maxMics) {
                    continue;
                }
                if (input.lod.maxRoundRobins > 0 && zone.rrPos >= input.lod.maxRoundRobins) {
                    continue;
                }
                zones.push(Object.freeze({ zone, articulationId: articulation.id }));
            }
        }
        if (input.lod.maxMics > 0) {
            numMics = Math.min(numMics, input.lod.maxMics);
        }
        if (zones.length === 0) {
            throw new TypeError(`Levain manifest ${manifest.instrumentId}@${manifest.version} has no playable zones`);
        }

        const files: string[] = [];
        const seenFiles = new Set<string>();
        for (const { zone } of zones) {
            if (seenFiles.has(zone.file)) {
                continue;
            }
            seenFiles.add(zone.file);
            files.push(zone.file);
        }
        for (const transition of manifest.legatoTransitions) {
            if (seenFiles.has(transition.file)) {
                continue;
            }
            seenFiles.add(transition.file);
            files.push(transition.file);
        }

        const samples = entry.samples;
        if (files.length === 0) {
            notifyProgress(entry, 1);
        } else {
            let completed = 0;
            let nextFileIndex = 0;

            async function decodeNextFile(): Promise<void> {
                while (nextFileIndex < files.length) {
                    if (controller.signal.aborted) {
                        throw createAbortError();
                    }
                    const file = files[nextFileIndex];
                    nextFileIndex++;
                    if (!file) {
                        return;
                    }
                    const url = `${input.basePath}/${encodePath(file)}`;
                    const sample = await scheduleSampleLoad({ signal: controller.signal, url });
                    throwIfAborted(controller.signal);
                    reserveDecodedSample(entry, sample);
                    samples.set(file, sample);
                    completed++;
                    notifyProgress(entry, completed / files.length);
                }
            }

            const workerCount = Math.min(files.length, maxConcurrentSampleLoads);
            const workers = Array.from({ length: workerCount }, () => decodeNextFile());
            try {
                await Promise.all(workers);
            } catch (error) {
                controller.abort();
                samples.clear();
                throw error;
            }
        }

        return Object.freeze({
            bankKey: entry.publicationKey,
            version: manifest.version,
            instrumentId: manifest.instrumentId,
            files: Object.freeze(files),
            samples,
            zones: Object.freeze(zones),
            legatoTransitions: manifest.legatoTransitions,
            numArticulations,
            numMics,
            decodedByteLength: entry.decodedBytes,
        });
    }

    function createEntry(
        key: string,
        baseKey: string,
        input: LoadDecodedBankInput,
        manifest: SampleManifest
    ): BankEntry {
        const controller = new AbortController();
        const entry: BankEntry = {
            key,
            publicationKey: allocateBankPublicationKey(key),
            baseKey,
            consumerController: new AbortController(),
            controller,
            consumers: new Set(),
            activeLeases: 0,
            decodedBytes: 0,
            lastAccess: ++accessSequence,
            listeners: new Map(),
            progress: 0,
            promise: null,
            samples: new Map(),
            retired: false,
            state: 'loading',
        };
        entry.promise = decodeBank({ controller, entry, input, manifest }).then(
            (bank) => {
                if (controller.signal.aborted) {
                    throw createAbortError();
                }
                entry.state = 'resolved';
                return bank;
            },
            (error: unknown) => {
                if (!(error instanceof DOMException && error.name === 'AbortError')) {
                    failedBanks++;
                }
                removeEntry({ entry, key, notifyConsumers: false });
                throw error;
            }
        );
        return entry;
    }

    function consumeEntry(key: string, entry: BankEntry, input: LoadDecodedBankInput): Promise<DecodedBankLease> {
        const sharedPromise = entry.promise;
        if (!sharedPromise) {
            throw new Error('Levain decoded-bank entry was consumed before initialization');
        }

        const token = Symbol('Levain decoded-bank consumer');
        entry.consumers.add(token);
        const listener = input.onProgress;
        const signal = input.signal;
        return new Promise((resolve, reject) => {
            let settled = false;

            function releaseConsumer(): void {
                if (signal) {
                    signal.removeEventListener('abort', onAbort);
                }
                entry.consumerController.signal.removeEventListener('abort', onAbort);
                entry.listeners.delete(token);
                entry.consumers.delete(token);
                if (entry.state === 'loading' && entry.consumers.size === 0 && entries.get(key) === entry) {
                    removeEntry({ entry, key });
                }
            }

            function createLease(bank: DecodedBank): DecodedBankLease {
                entry.activeLeases++;
                activeLeases++;
                let released = false;
                return Object.freeze({
                    bank,
                    release(): void {
                        if (released) {
                            return;
                        }
                        released = true;
                        entry.activeLeases--;
                        activeLeases--;
                        releaseRetiredEntry(entry);
                    },
                });
            }

            function onAbort(): void {
                if (settled) {
                    return;
                }
                settled = true;
                releaseConsumer();
                reject(createAbortError());
            }

            if (signal) {
                signal.addEventListener('abort', onAbort, { once: true });
            }
            entry.consumerController.signal.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted || entry.consumerController.signal.aborted) {
                onAbort();
            }
            if (!signal?.aborted && listener) {
                entry.listeners.set(token, listener);
                notifyListener(entry, token, listener, entry.progress);
            }
            void sharedPromise.then(
                (bank) => {
                    if (!settled) {
                        settled = true;
                        releaseConsumer();
                        if (entry.retired || entries.get(key) !== entry) {
                            reject(createAbortError());
                        } else {
                            resolve(createLease(bank));
                        }
                    }
                    return undefined;
                },
                (error: unknown) => {
                    if (!settled) {
                        settled = true;
                        releaseConsumer();
                        reject(normalizeError(error));
                    }
                    return undefined;
                }
            );
        });
    }

    return {
        async acquire(input): Promise<DecodedBankLease> {
            if (input.signal?.aborted) {
                throw createAbortError();
            }

            const baseKey = createCacheBaseKey(input);
            const expectedBaseEpoch = baseEpochs.get(baseKey) ?? 0;
            const expectedClearEpoch = clearEpoch;
            const manifestConsumer = registerPendingManifestConsumer(baseKey);
            let manifest: SampleManifest;
            try {
                manifest = await loadValidatedManifest(input, manifestConsumer.signal);
            } finally {
                releasePendingManifestConsumer(baseKey, manifestConsumer);
            }
            if (
                input.signal?.aborted ||
                clearEpoch !== expectedClearEpoch ||
                (baseEpochs.get(baseKey) ?? 0) !== expectedBaseEpoch
            ) {
                throw createAbortError();
            }

            const key = createCacheKey(baseKey, manifest);
            const previousKey = currentBankKeys.get(baseKey);
            if (previousKey && previousKey !== key) {
                const previousEntry = entries.get(previousKey);
                if (previousEntry) {
                    removeEntry({ entry: previousEntry, key: previousKey });
                } else {
                    currentBankKeys.delete(baseKey);
                }
            }

            let entry = entries.get(key);
            if (entry) {
                cacheHits++;
                entry.lastAccess = ++accessSequence;
            } else {
                cacheMisses++;
                entry = createEntry(key, baseKey, input, manifest);
                entries.set(key, entry);
            }
            currentBankKeys.set(baseKey, key);
            return consumeEntry(key, entry, input);
        },
        invalidate(input): void {
            const baseKey = createCacheBaseKey(input);
            baseEpochs.set(baseKey, (baseEpochs.get(baseKey) ?? 0) + 1);
            for (const controller of pendingManifestConsumers.get(baseKey) ?? []) {
                controller.abort();
            }
            pendingManifestConsumers.delete(baseKey);
            const key = currentBankKeys.get(baseKey);
            if (!key) {
                return;
            }
            const entry = entries.get(key);
            if (!entry) {
                currentBankKeys.delete(baseKey);
                return;
            }
            removeEntry({ entry, key });
        },
        clear(): void {
            clearEpoch++;
            for (const consumers of pendingManifestConsumers.values()) {
                for (const controller of consumers) {
                    controller.abort();
                }
            }
            for (const [key, entry] of entries) {
                removeEntry({ entry, key });
            }
            for (const entry of manifestEntries.values()) {
                entry.controller.abort();
            }
            entries.clear();
            currentBankKeys.clear();
            manifestEntries.clear();
            baseEpochs.clear();
            pendingManifestConsumers.clear();
        },
        getDiagnostics(): DecodedBankResourceDiagnostics {
            let resolvedBanks = 0;
            let inFlightBanks = 0;
            for (const entry of entries.values()) {
                if (entry.state === 'resolved') {
                    resolvedBanks++;
                } else {
                    inFlightBanks++;
                }
            }
            return {
                cacheHits,
                cacheMisses,
                manifestLoads,
                sampleLoads,
                sampleLoadFailures,
                failedBanks,
                evictions,
                resolvedBanks,
                inFlightBanks,
                decodedBytes,
                activeLeases,
                activeSampleLoads,
                queuedSampleLoads: sampleQueue.length - sampleQueueHead,
            };
        },
    };
}
