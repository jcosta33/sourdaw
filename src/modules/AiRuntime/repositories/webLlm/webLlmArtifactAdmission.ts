import { createWebLlmAppConfig } from './createWebLlmAppConfig';
import { getWebLlmArtifactUrl } from './getWebLlmArtifactUrl';
import { serializeWebLlmArtifactSet } from './serializeWebLlmArtifactSet';
import {
    getWebLlmArtifactManifestModel,
    type WebLlmArtifact,
    type WebLlmArtifactManifestModel,
} from './webLlmArtifactManifest';

import type { AppConfig } from '@mlc-ai/web-llm';

const PROVENANCE_CACHE_NAME = 'sourdaw/webllm/provenance-v1';
const WEBLLM_CACHE_NAMES = {
    config: 'webllm/config',
    model: 'webllm/model',
    wasm: 'webllm/wasm',
} as const;

type WebLlmArtifactAdmissionOptions = {
    consume?: (admission: WebLlmArtifactAdmission) => Promise<void>;
    downloadConsent?: boolean;
    onProgress?: (report: { progress: number; text: string }) => void;
    signal?: AbortSignal;
};

type WebLlmArtifactCache = {
    delete: (request: string) => Promise<boolean>;
    keys: () => Promise<readonly string[]>;
    match: (request: string) => Promise<Response | undefined>;
    put: (request: string, response: Response) => Promise<void>;
};

export type WebLlmArtifactAdmissionDependencies = {
    deleteCache: (cacheName: string) => Promise<boolean>;
    fetchArtifact: (url: string, signal: AbortSignal | undefined) => Promise<Response>;
    getManifestModel: (modelId: string) => WebLlmArtifactManifestModel;
    openCache: (cacheName: string) => Promise<WebLlmArtifactCache>;
    runExclusive: <Result>(
        lockName: string,
        signal: AbortSignal | undefined,
        operation: () => Promise<Result>
    ) => Promise<Result>;
    sha256: (bytes: ArrayBuffer) => Promise<string>;
};

export type WebLlmArtifactAdmission = {
    appConfig: AppConfig;
    artifactSetDigest: string;
};

type WebLlmArtifactProvenance = {
    schemaVersion: 1;
    modelId: string;
    artifactSetDigest: string;
    artifacts: readonly {
        cacheName: string;
        url: string;
    }[];
};

function requireCacheStorage(): CacheStorage {
    if (typeof caches === 'undefined') {
        throw new TypeError('Browser Cache Storage is required for verified WebLLM artifacts');
    }
    return caches;
}

async function productionSha256(bytes: ArrayBuffer): Promise<string> {
    if (!globalThis.crypto?.subtle) {
        throw new TypeError('Web Crypto is required for verified WebLLM artifacts');
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function runWithBrowserLock<Result>(
    lockName: string,
    signal: AbortSignal | undefined,
    operation: () => Promise<Result>
): Promise<Result> {
    if (typeof navigator === 'undefined' || !navigator.locks) {
        throw new TypeError('Browser Web Locks are required for verified WebLLM artifact admission');
    }
    return navigator.locks.request(lockName, { mode: 'exclusive', signal }, operation);
}

const productionDependencies: WebLlmArtifactAdmissionDependencies = {
    deleteCache: (cacheName) => requireCacheStorage().delete(cacheName),
    fetchArtifact: (url, signal) =>
        fetch(url, {
            cache: 'no-store',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            signal,
        }),
    getManifestModel: getWebLlmArtifactManifestModel,
    openCache: async (cacheName) => {
        const cache = await requireCacheStorage().open(cacheName);
        return {
            delete: (request) => cache.delete(request),
            keys: async () => (await cache.keys()).map((request) => request.url),
            match: (request) => cache.match(request),
            put: (request, response) => cache.put(request, response),
        };
    },
    runExclusive: runWithBrowserLock,
    sha256: productionSha256,
};

function stagingCacheName(modelId: string): string {
    return `sourdaw/webllm/staging-v1/${encodeURIComponent(modelId)}`;
}

function provenanceUrl(artifactSetDigest: string): string {
    return `https://sourdaw.invalid/webllm/provenance/${artifactSetDigest}`;
}

function cacheNameForArtifact(artifact: WebLlmArtifact): string {
    if (artifact.kind === 'config') {
        return WEBLLM_CACHE_NAMES.config;
    }
    if (artifact.kind === 'model-library') {
        return WEBLLM_CACHE_NAMES.wasm;
    }
    return WEBLLM_CACHE_NAMES.model;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExpectedProvenance(value: unknown, model: WebLlmArtifactManifestModel): value is WebLlmArtifactProvenance {
    return (
        isRecord(value) &&
        value.schemaVersion === 1 &&
        value.modelId === model.modelId &&
        value.artifactSetDigest === model.artifactSetDigest &&
        Array.isArray(value.artifacts) &&
        JSON.stringify(value.artifacts) === JSON.stringify(getProvenanceArtifacts(model))
    );
}

function getProvenanceArtifacts(model: WebLlmArtifactManifestModel): WebLlmArtifactProvenance['artifacts'] {
    return model.artifacts.map((artifact) => ({
        cacheName: cacheNameForArtifact(artifact),
        url: getWebLlmArtifactUrl(model, artifact),
    }));
}

function readStoredProvenance(value: unknown): WebLlmArtifactProvenance | null {
    if (
        !isRecord(value) ||
        value.schemaVersion !== 1 ||
        typeof value.modelId !== 'string' ||
        typeof value.artifactSetDigest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.artifactSetDigest) ||
        !Array.isArray(value.artifacts)
    ) {
        return null;
    }
    const artifacts: Array<{ cacheName: string; url: string }> = [];
    for (const artifact of value.artifacts) {
        if (
            !isRecord(artifact) ||
            (artifact.cacheName !== WEBLLM_CACHE_NAMES.config &&
                artifact.cacheName !== WEBLLM_CACHE_NAMES.model &&
                artifact.cacheName !== WEBLLM_CACHE_NAMES.wasm) ||
            typeof artifact.url !== 'string'
        ) {
            return null;
        }
        let origin: string;
        try {
            origin = new URL(artifact.url).origin;
        } catch {
            return null;
        }
        if (origin !== 'https://huggingface.co' && origin !== 'https://raw.githubusercontent.com') {
            return null;
        }
        artifacts.push({ cacheName: artifact.cacheName, url: artifact.url });
    }
    return {
        schemaVersion: 1,
        modelId: value.modelId,
        artifactSetDigest: value.artifactSetDigest,
        artifacts,
    };
}

async function verifyArtifactBytes(
    artifact: WebLlmArtifact,
    bytes: ArrayBuffer,
    artifactUrl: string,
    dependencies: WebLlmArtifactAdmissionDependencies
): Promise<void> {
    if (bytes.byteLength !== artifact.sizeBytes) {
        throw new Error(
            `WebLLM artifact size mismatch for ${artifactUrl}: expected ${String(artifact.sizeBytes)}, received ${String(bytes.byteLength)}`
        );
    }
    const digest = await dependencies.sha256(bytes);
    if (digest !== artifact.sha256) {
        throw new Error(`WebLLM artifact digest mismatch for ${artifactUrl}`);
    }
}

function parseArtifactJson(bytes: ArrayBuffer, artifactUrl: string): unknown {
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
        throw new Error(`WebLLM artifact metadata is invalid JSON: ${artifactUrl}`, { cause: error });
    }
}

function verifyArtifactMetadata(
    model: WebLlmArtifactManifestModel,
    artifact: WebLlmArtifact,
    bytes: ArrayBuffer,
    artifactUrl: string
): void {
    if (artifact.kind === 'config') {
        const config = parseArtifactJson(bytes, artifactUrl);
        if (!isRecord(config) || !Array.isArray(config.tokenizer_files)) {
            throw new Error(`WebLLM config is missing tokenizer_files: ${artifactUrl}`);
        }
        const tokenizerPaths = model.artifacts
            .filter((candidate) => candidate.kind === 'tokenizer')
            .map((candidate) => candidate.path);
        if (
            !config.tokenizer_files.every((path) => typeof path === 'string') ||
            JSON.stringify(config.tokenizer_files) !== JSON.stringify(tokenizerPaths)
        ) {
            throw new Error(`WebLLM tokenizer manifest does not match the model config: ${artifactUrl}`);
        }
        return;
    }
    if (artifact.kind !== 'weight-index') {
        return;
    }
    const index = parseArtifactJson(bytes, artifactUrl);
    if (!isRecord(index) || !Array.isArray(index.records)) {
        throw new Error(`WebLLM weight index is missing records: ${artifactUrl}`);
    }
    const indexedShards: Array<{ dataPath: string; nbytes: number }> = [];
    for (const record of index.records) {
        if (
            !isRecord(record) ||
            typeof record.dataPath !== 'string' ||
            typeof record.nbytes !== 'number' ||
            !Number.isSafeInteger(record.nbytes) ||
            record.nbytes <= 0
        ) {
            throw new Error(`WebLLM weight index contains an invalid shard: ${artifactUrl}`);
        }
        indexedShards.push({ dataPath: record.dataPath, nbytes: record.nbytes });
    }
    const manifestShards = model.artifacts
        .filter((candidate) => candidate.kind === 'weight-shard')
        .map((candidate) => ({ dataPath: candidate.path, nbytes: candidate.sizeBytes }));
    if (JSON.stringify(indexedShards) !== JSON.stringify(manifestShards)) {
        throw new Error(`WebLLM weight index does not match the admitted shard set: ${artifactUrl}`);
    }
}

async function deleteArtifactEntries(
    model: WebLlmArtifactManifestModel,
    dependencies: WebLlmArtifactAdmissionDependencies
): Promise<void> {
    for (const artifact of model.artifacts) {
        const cache = await dependencies.openCache(cacheNameForArtifact(artifact));
        await cache.delete(getWebLlmArtifactUrl(model, artifact));
    }
}

async function deleteProvenance(
    model: WebLlmArtifactManifestModel,
    dependencies: WebLlmArtifactAdmissionDependencies
): Promise<void> {
    const provenanceCache = await dependencies.openCache(PROVENANCE_CACHE_NAME);
    await provenanceCache.delete(provenanceUrl(model.artifactSetDigest));
}

async function purgeStoredProvenance(
    provenance: WebLlmArtifactProvenance,
    dependencies: WebLlmArtifactAdmissionDependencies
): Promise<void> {
    for (const artifact of provenance.artifacts) {
        const cache = await dependencies.openCache(artifact.cacheName);
        await cache.delete(artifact.url);
    }
    const provenanceCache = await dependencies.openCache(PROVENANCE_CACHE_NAME);
    await provenanceCache.delete(provenanceUrl(provenance.artifactSetDigest));
}

async function purgeRecordedArtifactSetsForModel(
    modelId: string,
    dependencies: WebLlmArtifactAdmissionDependencies,
    exceptDigest?: string
): Promise<void> {
    const provenanceCache = await dependencies.openCache(PROVENANCE_CACHE_NAME);
    for (const key of await provenanceCache.keys()) {
        const response = await provenanceCache.match(key);
        if (!response) {
            continue;
        }
        let value: unknown;
        try {
            value = await response.json();
        } catch {
            continue;
        }
        const stored = readStoredProvenance(value);
        if (stored && stored.modelId === modelId && stored.artifactSetDigest !== exceptDigest) {
            await purgeStoredProvenance(stored, dependencies);
        }
    }
}

async function purgeWebLlmModelArtifacts(
    modelId: string,
    dependencies: WebLlmArtifactAdmissionDependencies = productionDependencies
): Promise<void> {
    const model = dependencies.getManifestModel(modelId);
    await deleteArtifactEntries(model, dependencies);
    await deleteProvenance(model, dependencies);
    await dependencies.deleteCache(stagingCacheName(model.modelId));
    await purgeRecordedArtifactSetsForModel(modelId, dependencies);
}

async function readProvenance(
    model: WebLlmArtifactManifestModel,
    dependencies: WebLlmArtifactAdmissionDependencies
): Promise<'absent' | 'valid' | 'invalid'> {
    const provenanceCache = await dependencies.openCache(PROVENANCE_CACHE_NAME);
    const response = await provenanceCache.match(provenanceUrl(model.artifactSetDigest));
    if (!response) {
        return 'absent';
    }
    try {
        return isExpectedProvenance(await response.json(), model) ? 'valid' : 'invalid';
    } catch {
        return 'invalid';
    }
}

async function verifyPromotedArtifacts(
    model: WebLlmArtifactManifestModel,
    dependencies: WebLlmArtifactAdmissionDependencies
): Promise<void> {
    for (const artifact of model.artifacts) {
        const artifactUrl = getWebLlmArtifactUrl(model, artifact);
        const cache = await dependencies.openCache(cacheNameForArtifact(artifact));
        const response = await cache.match(artifactUrl);
        if (!response) {
            throw new Error(`Verified WebLLM artifact is missing from cache: ${artifactUrl}`);
        }
        await verifyArtifactBytes(artifact, await response.arrayBuffer(), artifactUrl, dependencies);
    }
}

async function fetchAndStageArtifacts(
    model: WebLlmArtifactManifestModel,
    signal: AbortSignal | undefined,
    dependencies: WebLlmArtifactAdmissionDependencies,
    onProgress: WebLlmArtifactAdmissionOptions['onProgress']
): Promise<void> {
    await deleteArtifactEntries(model, dependencies);
    await dependencies.deleteCache(stagingCacheName(model.modelId));
    const stagingCache = await dependencies.openCache(stagingCacheName(model.modelId));
    const totalBytes = model.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0);
    let verifiedBytes = 0;
    for (const artifact of model.artifacts) {
        signal?.throwIfAborted();
        const artifactUrl = getWebLlmArtifactUrl(model, artifact);
        const response = await dependencies.fetchArtifact(artifactUrl, signal);
        if (!response.ok) {
            throw new Error(`WebLLM artifact download failed for ${artifactUrl}: HTTP ${String(response.status)}`);
        }
        const bytes = await response.arrayBuffer();
        await verifyArtifactBytes(artifact, bytes, artifactUrl, dependencies);
        verifyArtifactMetadata(model, artifact, bytes, artifactUrl);
        signal?.throwIfAborted();
        await stagingCache.put(
            artifactUrl,
            new Response(bytes, {
                status: 200,
                headers: {
                    'content-length': String(bytes.byteLength),
                    'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
                },
            })
        );
        verifiedBytes += artifact.sizeBytes;
        onProgress?.({
            progress: verifiedBytes / totalBytes,
            text: `Verifying browser AI model… ${String(Math.round((verifiedBytes / totalBytes) * 100))}%`,
        });
    }
}

async function promoteStagedArtifacts(
    model: WebLlmArtifactManifestModel,
    dependencies: WebLlmArtifactAdmissionDependencies,
    signal: AbortSignal | undefined
): Promise<void> {
    const stagingName = stagingCacheName(model.modelId);
    const stagingCache = await dependencies.openCache(stagingName);
    for (const artifact of model.artifacts) {
        signal?.throwIfAborted();
        const artifactUrl = getWebLlmArtifactUrl(model, artifact);
        const response = await stagingCache.match(artifactUrl);
        if (!response) {
            throw new Error(`Verified WebLLM staging artifact is missing: ${artifactUrl}`);
        }
        const promotedCache = await dependencies.openCache(cacheNameForArtifact(artifact));
        await promotedCache.put(artifactUrl, response);
        await stagingCache.delete(artifactUrl);
    }
    await dependencies.deleteCache(stagingName);
}

async function promoteProvenance(
    model: WebLlmArtifactManifestModel,
    dependencies: WebLlmArtifactAdmissionDependencies
): Promise<void> {
    const provenance: WebLlmArtifactProvenance = {
        schemaVersion: 1,
        modelId: model.modelId,
        artifactSetDigest: model.artifactSetDigest,
        artifacts: getProvenanceArtifacts(model),
    };
    const provenanceCache = await dependencies.openCache(PROVENANCE_CACHE_NAME);
    await provenanceCache.put(
        provenanceUrl(model.artifactSetDigest),
        new Response(JSON.stringify(provenance), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })
    );
}

async function admitWebLlmModelArtifactsExclusive(
    modelId: string,
    options: WebLlmArtifactAdmissionOptions = {},
    dependencies: WebLlmArtifactAdmissionDependencies = productionDependencies
): Promise<WebLlmArtifactAdmission> {
    options.signal?.throwIfAborted();
    const model = dependencies.getManifestModel(modelId);
    const artifactSetBytes = new TextEncoder().encode(serializeWebLlmArtifactSet(model));
    const artifactSetDigest = await dependencies.sha256(artifactSetBytes.buffer);
    if (artifactSetDigest !== model.artifactSetDigest) {
        throw new Error(`WebLLM release artifact-set digest mismatch for ${model.modelId}`);
    }
    await purgeRecordedArtifactSetsForModel(model.modelId, dependencies, model.artifactSetDigest);
    const provenance = await readProvenance(model, dependencies);

    if (provenance === 'valid') {
        try {
            await verifyPromotedArtifacts(model, dependencies);
        } catch (error) {
            await purgeWebLlmModelArtifacts(modelId, dependencies);
            throw new Error(
                'Verified WebLLM cache was missing or poisoned and has been purged. Explicit consent is required to download it again.',
                { cause: error }
            );
        }
        return {
            appConfig: createWebLlmAppConfig(model),
            artifactSetDigest: model.artifactSetDigest,
        };
    }

    if (provenance === 'invalid') {
        await purgeWebLlmModelArtifacts(modelId, dependencies);
        throw new Error(
            'WebLLM cache provenance was invalid and has been purged. Explicit consent is required to download it again.'
        );
    }

    if (options.downloadConsent !== true) {
        throw new Error('Explicit model-download consent is required before WebLLM can fetch this artifact set.');
    }

    try {
        await fetchAndStageArtifacts(model, options.signal, dependencies, options.onProgress);
        options.signal?.throwIfAborted();
        await promoteStagedArtifacts(model, dependencies, options.signal);
        options.signal?.throwIfAborted();
        await promoteProvenance(model, dependencies);
    } catch (error) {
        await purgeWebLlmModelArtifacts(modelId, dependencies);
        throw error;
    }

    return {
        appConfig: createWebLlmAppConfig(model),
        artifactSetDigest: model.artifactSetDigest,
    };
}

export function admitWebLlmModelArtifacts(
    modelId: string,
    options: WebLlmArtifactAdmissionOptions = {},
    dependencies: WebLlmArtifactAdmissionDependencies = productionDependencies
): Promise<WebLlmArtifactAdmission> {
    return dependencies.runExclusive(`sourdaw:webllm-admission-v1:${modelId}`, options.signal, async () => {
        const admission = await admitWebLlmModelArtifactsExclusive(modelId, options, dependencies);
        await options.consume?.(admission);
        return admission;
    });
}
