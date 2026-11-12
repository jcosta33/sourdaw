import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { logger } from '#/infra/logger/appLogger';

import { DEFAULT_WEBLLM_MODEL_ID, WEBLLM_CONTEXT_WINDOW_TOKENS, WEBLLM_MODELS } from '../../models/ModelInfo';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { LocalModelRefusalError } from '../../errors/LocalModelRefusalError';
import { createWebLlmAppConfig } from '../webLlm/createWebLlmAppConfig';
import { engineState } from '../webLlm/engineLifecycleState';
import { getWebLlmArtifactUrl } from '../webLlm/getWebLlmArtifactUrl';
import { getWebLlmContextWindowSize } from '../webLlm/getWebLlmContextWindowSize';
import { getWebLlmRequiredFeatures } from '../webLlm/getWebLlmRequiredFeatures';
import { initWebLlmEngine } from '../webLlm/initWebLlmEngine';
import { serializeWebLlmArtifactSet } from '../webLlm/serializeWebLlmArtifactSet';
import { unloadWebLlmEngine } from '../webLlm/unloadWebLlmEngine';
import { admitWebLlmModelArtifacts, type WebLlmArtifactAdmissionDependencies } from '../webLlm/webLlmArtifactAdmission';
import {
    getWebLlmArtifactManifestModel,
    type WebLlmArtifact,
    type WebLlmArtifactManifestModel,
} from '../webLlm/webLlmArtifactManifest';

const { createWebWorkerEngineMock, terminateWorkerMock, workerSpawns } = vi.hoisted(() => ({
    createWebWorkerEngineMock: vi.fn(),
    terminateWorkerMock: vi.fn(),
    workerSpawns: [] as { url: string | URL; options: WorkerOptions | undefined }[],
}));

const requestAdapterMock = vi.fn<() => Promise<{ features: Set<string> } | null>>();
const cacheEntries = new Map<string, Map<string, Response>>();
const exclusiveLockCalls: string[] = [];
const exclusiveTailByName = new Map<string, Promise<void>>();
const fixtureContents = new Map<string, string>([
    ['mlc-chat-config.json', JSON.stringify({ tokenizer_files: ['tokenizer.json'] })],
    ['tensor-cache.json', JSON.stringify({ records: [{ dataPath: 'params_shard_0.bin', nbytes: 7 }] })],
    ['tokenizer.json', 'tokenizer'],
    ['params_shard_0.bin', 'weights'],
    ['web-llm-models/v1/model.wasm', 'wasm'],
]);
const fixtureDigests = new Map<string, string>(
    Array.from(fixtureContents.values(), (content, index) => [content, String(index + 1).repeat(64)])
);

function createFixtureArtifacts(): WebLlmArtifact[] {
    const encoder = new TextEncoder();
    const artifactDefinitions = [
        { kind: 'config', source: 'model', path: 'mlc-chat-config.json' },
        { kind: 'weight-index', source: 'model', path: 'tensor-cache.json' },
        { kind: 'tokenizer', source: 'model', path: 'tokenizer.json' },
        { kind: 'weight-shard', source: 'model', path: 'params_shard_0.bin' },
        { kind: 'model-library', source: 'wasm', path: 'web-llm-models/v1/model.wasm' },
    ] satisfies Array<Pick<WebLlmArtifact, 'kind' | 'source' | 'path'>>;
    return artifactDefinitions.map((artifact) => {
        const content = fixtureContents.get(artifact.path);
        if (!content) {
            throw new Error(`Missing fixture content for ${artifact.path}`);
        }
        const digest = fixtureDigests.get(content);
        if (!digest) {
            throw new Error(`Missing fixture digest for ${artifact.path}`);
        }
        return {
            ...artifact,
            sizeBytes: encoder.encode(content).byteLength,
            sha256: digest,
        };
    });
}

const fixtureModel: WebLlmArtifactManifestModel = {
    modelId: 'fixture-model',
    artifactSetDigest: 'f'.repeat(64),
    modelSource: {
        origin: 'https://huggingface.co',
        repository: 'mlc-ai/fixture-model',
        revision: 'a'.repeat(40),
    },
    wasmSource: {
        origin: 'https://raw.githubusercontent.com',
        repository: 'mlc-ai/binary-mlc-llm-libs',
        revision: 'b'.repeat(40),
    },
    engine: {
        contextWindowSize: 4096,
        vramRequiredMb: 256,
        lowResourceRequired: true,
    },
    artifacts: createFixtureArtifacts(),
};

async function runExclusiveForTests<Result>(
    lockName: string,
    signal: AbortSignal | undefined,
    operation: () => Promise<Result>
): Promise<Result> {
    const previous = exclusiveTailByName.get(lockName) ?? Promise.resolve();
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => released);
    exclusiveTailByName.set(lockName, tail);
    await previous.catch(() => undefined);
    signal?.throwIfAborted();
    try {
        return await operation();
    } finally {
        release();
        if (exclusiveTailByName.get(lockName) === tail) {
            exclusiveTailByName.delete(lockName);
        }
    }
}

async function runExclusiveDependency<Result>(
    lockName: string,
    signal: AbortSignal | undefined,
    operation: () => Promise<Result>
): Promise<Result> {
    exclusiveLockCalls.push(lockName);
    return runExclusiveForTests(lockName, signal, operation);
}

function installCacheStorage(): void {
    Object.defineProperty(globalThis, 'caches', {
        configurable: true,
        value: {
            delete: vi.fn(async (cacheName: string) => cacheEntries.delete(cacheName)),
            open: vi.fn(async (cacheName: string) => {
                const entries = cacheEntries.get(cacheName) ?? new Map<string, Response>();
                cacheEntries.set(cacheName, entries);
                return {
                    delete: vi.fn(async (request: RequestInfo | URL) =>
                        entries.delete(request instanceof Request ? request.url : String(request))
                    ),
                    keys: vi.fn(async () => Array.from(entries.keys(), (url) => new Request(url))),
                    match: vi.fn(async (request: RequestInfo | URL) =>
                        entries.get(request instanceof Request ? request.url : String(request))?.clone()
                    ),
                    put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
                        entries.set(request instanceof Request ? request.url : String(request), response.clone());
                    }),
                };
            }),
        },
    });
}

function createAdmissionDependencies(
    overrides: Partial<WebLlmArtifactAdmissionDependencies> = {}
): WebLlmArtifactAdmissionDependencies {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    return {
        deleteCache: async (cacheName) => cacheEntries.delete(cacheName),
        estimateStorage: async () => ({ quota: 1_000_000, usage: 0 }),
        fetchArtifact: vi.fn(async (url: string) => {
            const artifact = fixtureModel.artifacts.find(
                (candidate) => getWebLlmArtifactUrl(fixtureModel, candidate) === url
            );
            const content = artifact ? fixtureContents.get(artifact.path) : undefined;
            if (!content) {
                return new Response(null, { status: 404 });
            }
            return new Response(encoder.encode(content), {
                status: 200,
                headers: { 'content-type': 'application/octet-stream' },
            });
        }),
        getManifestModel: (modelId) => {
            if (modelId !== fixtureModel.modelId) {
                throw new Error(`unadmitted fixture model: ${modelId}`);
            }
            return fixtureModel;
        },
        openCache: async (cacheName) => {
            const entries = cacheEntries.get(cacheName) ?? new Map<string, Response>();
            cacheEntries.set(cacheName, entries);
            return {
                delete: async (request) => entries.delete(request),
                keys: async () => Array.from(entries.keys()),
                match: async (request) => entries.get(request)?.clone(),
                put: async (request, response) => {
                    entries.set(request, response.clone());
                },
            };
        },
        runExclusive: runExclusiveDependency,
        sha256: vi.fn(async (bytes: ArrayBuffer) => {
            const content = decoder.decode(bytes);
            if (content === serializeWebLlmArtifactSet(fixtureModel)) {
                return fixtureModel.artifactSetDigest;
            }
            const digest = fixtureDigests.get(content);
            return digest ?? '0'.repeat(64);
        }),
        ...overrides,
    };
}

function expectFixtureCachesEmpty(): void {
    for (const entries of cacheEntries.values()) {
        expect(entries.size).toBe(0);
    }
}

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('@mlc-ai/web-llm', () => ({
    CreateWebWorkerMLCEngine: createWebWorkerEngineMock,
}));

class MockLlmWorker extends EventTarget {
    constructor(url: string | URL, options?: WorkerOptions) {
        super();
        workerSpawns.push({ url, options });
    }

    terminate(): void {
        terminateWorkerMock();
    }
}

describe('WebLLM provider artifact admission', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workerSpawns.length = 0;
        vi.stubGlobal('Worker', MockLlmWorker);
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                gpu: { requestAdapter: requestAdapterMock },
                locks: {
                    request: vi.fn(
                        async (
                            name: string,
                            _options: LockOptions,
                            callback: (lock: Lock | null) => Promise<unknown>
                        ) => callback({ name, mode: 'exclusive' })
                    ),
                },
            },
            configurable: true,
            writable: true,
        });
        requestAdapterMock.mockReset();
        requestAdapterMock.mockResolvedValue({ features: new Set(['shader-f16']) });
        llmStatusStore.set({ state: 'idle' });
        cacheEntries.clear();
        exclusiveLockCalls.length = 0;
        exclusiveTailByName.clear();
        installCacheStorage();
        createWebWorkerEngineMock.mockResolvedValue({
            interruptGenerate: vi.fn(),
            chat: { completions: { create: vi.fn() } },
        });
    });

    afterEach(() => {
        Container.clear();
        unloadWebLlmEngine();
        vi.unstubAllGlobals();
        engineState.activeModelId = DEFAULT_WEBLLM_MODEL_ID;
        engineState.activeArtifactSetDigest = null;
    });

    it('requires explicit model-download consent before a fresh artifact set can fetch or start a worker', async () => {
        await expect(
            initWebLlmEngine('Qwen3-1.7B-q4f16_1-MLC', {
                downloadConsent: false,
            })
        ).rejects.toThrow(/explicit.*consent/i);

        expect(createWebWorkerEngineMock).not.toHaveBeenCalled();
        expect(terminateWorkerMock).not.toHaveBeenCalled();
        expect(workerSpawns).toEqual([]);
    });

    it('rejects an unmanifested model before cache access or private worker creation', async () => {
        await expect(
            initWebLlmEngine('mutable-or-unknown-model', {
                downloadConsent: true,
            })
        ).rejects.toThrow(/not admitted by this Sourdaw release/i);

        expect(createWebWorkerEngineMock).not.toHaveBeenCalled();
        expect(workerSpawns).toEqual([]);
        expect(cacheEntries.size).toBe(0);
    });

    it('ships one complete immutable release-owned artifact set for every selectable model', () => {
        for (const selectableModel of WEBLLM_MODELS) {
            const model = getWebLlmArtifactManifestModel(selectableModel.id);
            expect(model.modelSource.origin).toBe('https://huggingface.co');
            expect(model.wasmSource.origin).toBe('https://raw.githubusercontent.com');
            expect(model.modelSource.revision).toMatch(/^[a-f0-9]{40}$/);
            expect(model.wasmSource.revision).toMatch(/^[a-f0-9]{40}$/);
            expect(model.artifactSetDigest).toMatch(/^[a-f0-9]{64}$/);
            expect(model.artifacts.filter((artifact) => artifact.kind === 'config')).toHaveLength(1);
            expect(model.artifacts.filter((artifact) => artifact.kind === 'weight-index')).toHaveLength(1);
            expect(model.artifacts.filter((artifact) => artifact.kind === 'model-library')).toHaveLength(1);
            expect(model.artifacts.some((artifact) => artifact.kind === 'tokenizer')).toBe(true);
            expect(model.artifacts.some((artifact) => artifact.kind === 'weight-shard')).toBe(true);

            for (const artifact of model.artifacts) {
                expect(artifact.sizeBytes).toBeGreaterThan(0);
                expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
                const url = getWebLlmArtifactUrl(model, artifact);
                const source = artifact.source === 'model' ? model.modelSource : model.wasmSource;
                expect(new URL(url).origin).toBe(source.origin);
                expect(url).toContain(source.revision);
            }
        }
    });

    // Admission refuses a model whose recorded digest is not the digest of its serialized set.
    it('records each artifact-set digest over the set it ships', () => {
        for (const selectableModel of WEBLLM_MODELS) {
            const model = getWebLlmArtifactManifestModel(selectableModel.id);
            expect(createHash('sha256').update(serializeWebLlmArtifactSet(model)).digest('hex')).toBe(
                model.artifactSetDigest
            );
        }
    });

    // Admission purges every recorded set of a model whose digest differs from the release's, and a
    // purged model needs consent and a full download again. A digest that moves, its engine block
    // included, costs every user who downloaded the model that download; these are the digests the
    // shipped sets were recorded under.
    it.each([
        ['Qwen3-1.7B-q4f16_1-MLC', '932ad158daa0d6814a50c5fb6aa85f88c3d3892a58a0dc20d47ff0b9e6e0b255'],
        ['Qwen3-4B-q4f16_1-MLC', '2438f2a6b58372e12ca0aa949443a49ca7b6060ad3e7971aed0d56b49a35195f'],
        ['Qwen3-8B-q4f16_1-MLC', '7e7da9410d3b7cdeea46c0c2f417e560e54a2c736e8474e04b85e466e41022bb'],
    ])('keeps the artifact-set digest %s was downloaded under', (modelId, digest) => {
        expect(getWebLlmArtifactManifestModel(modelId).artifactSetDigest).toBe(digest);
    });

    it('loads the planning window from code, apart from the digested manifest', () => {
        expect(DEFAULT_WEBLLM_MODEL_ID).toBe('Qwen3-8B-q4f16_1-MLC');
        expect(getWebLlmContextWindowSize('Qwen3-8B-q4f16_1-MLC')).toBe(32_768);
        expect(getWebLlmContextWindowSize('Qwen3-4B-q4f16_1-MLC')).toBe(8_192);
        expect(getWebLlmContextWindowSize('Qwen3-1.7B-q4f16_1-MLC')).toBe(8_192);
        for (const selectableModel of WEBLLM_MODELS) {
            expect(getWebLlmContextWindowSize(selectableModel.id)).toBe(
                WEBLLM_CONTEXT_WINDOW_TOKENS[selectableModel.id]
            );
        }
        expect(() => getWebLlmContextWindowSize('mutable-or-unknown-model')).toThrow(/no context window/);
    });

    // The manifest records web-llm's published VRAM figure, in MiB, at its own window: the weights,
    // the runtime workspace, and the KV cache for that window. Every token the model loads beyond it
    // adds its KV cache: K and V for 8 KV heads × 128 dimensions at 2 bytes (q4f16 keeps the cache in
    // float16) in each layer — 28 in Qwen3-1.7B, 36 in Qwen3-4B (its MLC config) and Qwen3-8B. The
    // picker states decimal gigabytes, like the download size beside it, rounded up to a tenth.
    it.each([
        { modelId: 'Qwen3-1.7B-q4f16_1-MLC', layers: 28, vramMib: 2_484.66, shown: '~2.7 GB' },
        { modelId: 'Qwen3-4B-q4f16_1-MLC', layers: 36, vramMib: 4_007.59, shown: '~4.3 GB' },
        { modelId: 'Qwen3-8B-q4f16_1-MLC', layers: 36, vramMib: 9_727.78, shown: '~10.3 GB' },
    ])('publishes the memory need of $modelId for the window it loads with', ({ modelId, layers, vramMib, shown }) => {
        const bytesPerMib = 1024 * 1024;
        const kvCacheMibPerToken = (2 * 8 * 128 * 2 * layers) / bytesPerMib;
        const model = getWebLlmArtifactManifestModel(modelId);
        const loadedWindow = getWebLlmContextWindowSize(modelId);
        const derivedMib =
            model.engine.vramRequiredMb + (loadedWindow - model.engine.contextWindowSize) * kvCacheMibPerToken;
        const gigabytes = (derivedMib * bytesPerMib) / 1e9;

        expect(derivedMib).toBeCloseTo(vramMib, 2);
        expect(`~${(Math.ceil(gigabytes * 10) / 10).toFixed(1)} GB`).toBe(shown);
        expect(WEBLLM_MODELS.find((entry) => entry.id === modelId)?.ramUsage).toBe(shown);
    });

    it('cryptographically binds every release artifact-set digest to its exact manifest entries', async () => {
        for (const selectableModel of WEBLLM_MODELS) {
            const dependencies = createAdmissionDependencies({
                getManifestModel: getWebLlmArtifactManifestModel,
                sha256: async (bytes) => {
                    const digest = await crypto.subtle.digest('SHA-256', bytes);
                    return Array.from(new Uint8Array(digest))
                        .map((byte) => byte.toString(16).padStart(2, '0'))
                        .join('');
                },
            });

            await expect(admitWebLlmModelArtifacts(selectableModel.id, {}, dependencies)).rejects.toThrow(
                /explicit.*consent/i
            );
        }
    });

    it('downloads and verifies the complete selected artifact set before recording digest-keyed provenance', async () => {
        const dependencies = createAdmissionDependencies();
        const onProgress = vi.fn();

        const admission = await admitWebLlmModelArtifacts(
            fixtureModel.modelId,
            { downloadConsent: true, onProgress },
            dependencies
        );

        expect(dependencies.fetchArtifact).toHaveBeenCalledTimes(fixtureModel.artifacts.length);
        expect(dependencies.sha256).toHaveBeenCalledTimes(fixtureModel.artifacts.length + 1);
        expect(admission.artifactSetDigest).toBe(fixtureModel.artifactSetDigest);
        expect(onProgress).toHaveBeenCalledTimes(fixtureModel.artifacts.length);
        expect(onProgress).toHaveBeenLastCalledWith({
            progress: 1,
            text: 'Verifying browser AI model… 100%',
        });
        const modelRecord = admission.appConfig.model_list[0];
        expect(modelRecord).toBeDefined();
        expect(modelRecord?.model).toContain(fixtureModel.modelSource.revision);
        expect(modelRecord?.model_lib).toContain(fixtureModel.wasmSource.revision);
        expect(modelRecord?.integrity?.onFailure).toBe('error');
        const provenanceEntries = cacheEntries.get('sourdaw/webllm/provenance-v1');
        expect(provenanceEntries).toBeDefined();
        expect(Array.from(provenanceEntries?.keys() ?? [])).toEqual([
            expect.stringContaining(fixtureModel.artifactSetDigest),
        ]);
    });

    it('keeps verified files in private staging until the final artifact passes', async () => {
        const baseDependencies = createAdmissionDependencies();
        const finalArtifact = fixtureModel.artifacts.at(-1);
        expect(finalArtifact).toBeDefined();
        if (!finalArtifact) {
            throw new Error('Fixture final artifact is required');
        }
        const finalUrl = getWebLlmArtifactUrl(fixtureModel, finalArtifact);
        let releaseFinalArtifact: (response: Response) => void = () => {};
        const dependencies = createAdmissionDependencies({
            fetchArtifact: vi.fn(async (url, signal) => {
                if (url === finalUrl) {
                    return new Promise<Response>((resolve) => {
                        releaseFinalArtifact = resolve;
                    });
                }
                return baseDependencies.fetchArtifact(url, signal);
            }),
        });

        const pending = admitWebLlmModelArtifacts(fixtureModel.modelId, { downloadConsent: true }, dependencies);
        await vi.waitFor(() => expect(dependencies.fetchArtifact).toHaveBeenCalledTimes(fixtureModel.artifacts.length));

        expect(cacheEntries.get('webllm/config')?.size ?? 0).toBe(0);
        expect(cacheEntries.get('webllm/model')?.size ?? 0).toBe(0);
        expect(cacheEntries.get('webllm/wasm')?.size ?? 0).toBe(0);
        expect(cacheEntries.get('sourdaw/webllm/provenance-v1')?.size ?? 0).toBe(0);
        expect(cacheEntries.get(`sourdaw/webllm/staging-v1/${fixtureModel.modelId}`)?.size).toBe(
            fixtureModel.artifacts.length - 1
        );

        releaseFinalArtifact(await baseDependencies.fetchArtifact(finalUrl, undefined));
        await pending;

        expect(cacheEntries.has(`sourdaw/webllm/staging-v1/${fixtureModel.modelId}`)).toBe(false);
        expect(cacheEntries.get('sourdaw/webllm/provenance-v1')?.size).toBe(1);
    });

    it('does not fetch a fresh artifact set without explicit download consent', async () => {
        const dependencies = createAdmissionDependencies();

        await expect(admitWebLlmModelArtifacts(fixtureModel.modelId, {}, dependencies)).rejects.toThrow(
            /explicit.*consent/i
        );

        expect(dependencies.fetchArtifact).not.toHaveBeenCalled();
        expectFixtureCachesEmpty();
    });

    it('acquires browser-wide model admission ownership before reading or mutating shared caches', async () => {
        const dependencies = createAdmissionDependencies();

        await expect(admitWebLlmModelArtifacts(fixtureModel.modelId, {}, dependencies)).rejects.toThrow(
            /explicit.*consent/i
        );

        expect(exclusiveLockCalls).toEqual([`sourdaw:webllm-admission-v1:${fixtureModel.modelId}`]);
    });

    it('retains browser-wide ownership while the verified artifact set is consumed', async () => {
        const dependencies = createAdmissionDependencies();
        const replacementModel: WebLlmArtifactManifestModel = {
            ...fixtureModel,
            artifactSetDigest: 'd'.repeat(64),
            modelSource: {
                ...fixtureModel.modelSource,
                revision: 'c'.repeat(40),
            },
        };
        const replacementBaseDependencies = createAdmissionDependencies();
        const replacementDependencies = createAdmissionDependencies({
            fetchArtifact: vi.fn(async (url) => {
                const artifact = replacementModel.artifacts.find(
                    (candidate) => getWebLlmArtifactUrl(replacementModel, candidate) === url
                );
                const content = artifact ? fixtureContents.get(artifact.path) : undefined;
                return content ? new Response(content) : new Response(null, { status: 404 });
            }),
            getManifestModel: () => replacementModel,
            sha256: vi.fn(async (bytes) => {
                if (new TextDecoder().decode(bytes) === serializeWebLlmArtifactSet(replacementModel)) {
                    return replacementModel.artifactSetDigest;
                }
                return replacementBaseDependencies.sha256(bytes);
            }),
        });
        let consumerStarted = false;
        let releaseConsumer: () => void = () => {};
        const consumerFinished = new Promise<void>((resolve) => {
            releaseConsumer = resolve;
        });

        const admission = admitWebLlmModelArtifacts(
            fixtureModel.modelId,
            {
                downloadConsent: true,
                consume: async () => {
                    consumerStarted = true;
                    await consumerFinished;
                },
            },
            dependencies
        );
        await vi.waitFor(() => expect(consumerStarted).toBe(true));
        const competingAdmission = admitWebLlmModelArtifacts(
            replacementModel.modelId,
            { downloadConsent: true },
            replacementDependencies
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(exclusiveLockCalls).toHaveLength(2);
        expect(replacementDependencies.fetchArtifact).not.toHaveBeenCalled();
        releaseConsumer();
        await expect(admission).resolves.toMatchObject({ artifactSetDigest: fixtureModel.artifactSetDigest });
        await expect(competingAdmission).resolves.toMatchObject({
            artifactSetDigest: replacementModel.artifactSetDigest,
        });
    });

    it('revalidates an admitted cache without downloading the artifacts again', async () => {
        const dependencies = createAdmissionDependencies();
        await admitWebLlmModelArtifacts(fixtureModel.modelId, { downloadConsent: true }, dependencies);
        vi.mocked(dependencies.fetchArtifact).mockClear();
        vi.mocked(dependencies.sha256).mockClear();

        await expect(admitWebLlmModelArtifacts(fixtureModel.modelId, {}, dependencies)).resolves.toMatchObject({
            artifactSetDigest: fixtureModel.artifactSetDigest,
        });

        expect(dependencies.fetchArtifact).not.toHaveBeenCalled();
        expect(dependencies.sha256).toHaveBeenCalledTimes(fixtureModel.artifacts.length + 1);
    });

    it('purges and rejects a poisoned admitted cache before worker load or redownload', async () => {
        const dependencies = createAdmissionDependencies();
        await admitWebLlmModelArtifacts(fixtureModel.modelId, { downloadConsent: true }, dependencies);
        const poisonedArtifact = fixtureModel.artifacts.find((artifact) => artifact.kind === 'weight-shard');
        expect(poisonedArtifact).toBeDefined();
        if (!poisonedArtifact) {
            throw new Error('Fixture weight shard is required');
        }
        const modelCache = cacheEntries.get('webllm/model');
        modelCache?.set(getWebLlmArtifactUrl(fixtureModel, poisonedArtifact), new Response('poison'));
        vi.mocked(dependencies.fetchArtifact).mockClear();

        await expect(
            admitWebLlmModelArtifacts(fixtureModel.modelId, { downloadConsent: true }, dependencies)
        ).rejects.toThrow(/poisoned.*purged/i);

        expect(dependencies.fetchArtifact).not.toHaveBeenCalled();
        expectFixtureCachesEmpty();
    });

    it('purges invalid digest provenance without trusting or redownloading its cache entries', async () => {
        const dependencies = createAdmissionDependencies();
        await admitWebLlmModelArtifacts(fixtureModel.modelId, { downloadConsent: true }, dependencies);
        const provenanceEntries = cacheEntries.get('sourdaw/webllm/provenance-v1');
        const provenanceKey = Array.from(provenanceEntries?.keys() ?? [])[0];
        expect(provenanceKey).toBeDefined();
        if (!provenanceKey) {
            throw new Error('Fixture provenance key is required');
        }
        provenanceEntries?.set(
            provenanceKey,
            new Response(
                JSON.stringify({
                    schemaVersion: 1,
                    modelId: fixtureModel.modelId,
                    artifactSetDigest: '0'.repeat(64),
                })
            )
        );
        vi.mocked(dependencies.fetchArtifact).mockClear();

        await expect(
            admitWebLlmModelArtifacts(fixtureModel.modelId, { downloadConsent: true }, dependencies)
        ).rejects.toThrow(/provenance.*invalid.*purged/i);

        expect(dependencies.fetchArtifact).not.toHaveBeenCalled();
        expectFixtureCachesEmpty();
    });

    it('removes superseded release artifacts before requiring consent for the new digest', async () => {
        const dependencies = createAdmissionDependencies();
        const oldDigest = 'e'.repeat(64);
        const oldArtifactUrl = `https://huggingface.co/mlc-ai/fixture-model/resolve/${'c'.repeat(40)}/params_shard_0.bin`;
        cacheEntries.set('webllm/model', new Map([[oldArtifactUrl, new Response('old-weights')]]));
        cacheEntries.set(
            'sourdaw/webllm/provenance-v1',
            new Map([
                [
                    `https://sourdaw.invalid/webllm/provenance/${oldDigest}`,
                    new Response(
                        JSON.stringify({
                            schemaVersion: 1,
                            modelId: fixtureModel.modelId,
                            artifactSetDigest: oldDigest,
                            artifacts: [{ cacheName: 'webllm/model', url: oldArtifactUrl }],
                        })
                    ),
                ],
            ])
        );

        await expect(admitWebLlmModelArtifacts(fixtureModel.modelId, {}, dependencies)).rejects.toThrow(
            /explicit.*consent/i
        );

        expect(cacheEntries.get('webllm/model')?.has(oldArtifactUrl)).toBe(false);
        expect(cacheEntries.get('sourdaw/webllm/provenance-v1')?.size).toBe(0);
    });

    it.each([
        ['size', new Response('wrong-size')],
        ['digest', new Response('bad-token')],
    ])('purges every staged entry when an artifact has a %s mismatch', async (_failure, badResponse) => {
        const expectedUrl = getWebLlmArtifactUrl(fixtureModel, fixtureModel.artifacts[2]!);
        const dependencies = createAdmissionDependencies({
            fetchArtifact: vi.fn(async (url, signal) => {
                if (url === expectedUrl) {
                    return badResponse.clone();
                }
                return createAdmissionDependencies().fetchArtifact(url, signal);
            }),
        });

        await expect(
            admitWebLlmModelArtifacts(fixtureModel.modelId, { downloadConsent: true }, dependencies)
        ).rejects.toThrow(/mismatch/i);

        expectFixtureCachesEmpty();
    });

    it('rejects a signed weight index whose shard topology differs from the release manifest', async () => {
        const weightIndex = fixtureModel.artifacts.find((artifact) => artifact.kind === 'weight-index');
        expect(weightIndex).toBeDefined();
        if (!weightIndex) {
            throw new Error('Fixture weight index is required');
        }
        const poisonedIndex = JSON.stringify({
            records: [{ dataPath: 'params_shard_X.bin', nbytes: 7 }],
        });
        const expectedUrl = getWebLlmArtifactUrl(fixtureModel, weightIndex);
        const baseDependencies = createAdmissionDependencies();
        const dependencies = createAdmissionDependencies({
            fetchArtifact: vi.fn(async (url, signal) =>
                url === expectedUrl ? new Response(poisonedIndex) : baseDependencies.fetchArtifact(url, signal)
            ),
            sha256: vi.fn(async (bytes) => {
                const decoded = new TextDecoder().decode(bytes);
                if (decoded === poisonedIndex) {
                    return weightIndex.sha256;
                }
                return baseDependencies.sha256(bytes);
            }),
        });

        await expect(
            admitWebLlmModelArtifacts(fixtureModel.modelId, { downloadConsent: true }, dependencies)
        ).rejects.toThrow(/weight index does not match.*shard set/i);

        expectFixtureCachesEmpty();
    });

    it('purges promoted and staged entries when cache promotion fails partway through', async () => {
        const baseDependencies = createAdmissionDependencies();
        let rejectedPromotion = false;
        const dependencies = createAdmissionDependencies({
            openCache: async (cacheName) => {
                const cache = await baseDependencies.openCache(cacheName);
                if (cacheName !== 'webllm/model') {
                    return cache;
                }
                return {
                    ...cache,
                    put: async (request, response) => {
                        if (!rejectedPromotion) {
                            rejectedPromotion = true;
                            throw new Error('cache quota exhausted');
                        }
                        await cache.put(request, response);
                    },
                };
            },
        });

        await expect(
            admitWebLlmModelArtifacts(fixtureModel.modelId, { downloadConsent: true }, dependencies)
        ).rejects.toThrow('cache quota exhausted');

        expectFixtureCachesEmpty();
    });

    it('purges partial downloads when the caller cancels admission', async () => {
        const controller = new AbortController();
        let fetchCount = 0;
        const baseDependencies = createAdmissionDependencies();
        const dependencies = createAdmissionDependencies({
            fetchArtifact: vi.fn(async (url, signal) => {
                fetchCount += 1;
                if (fetchCount === 2) {
                    controller.abort(new DOMException('cancelled', 'AbortError'));
                }
                return baseDependencies.fetchArtifact(url, signal);
            }),
        });

        await expect(
            admitWebLlmModelArtifacts(
                fixtureModel.modelId,
                { downloadConsent: true, signal: controller.signal },
                dependencies
            )
        ).rejects.toMatchObject({ name: 'AbortError' });

        expectFixtureCachesEmpty();
    });

    it('serializes same-model restarts so aborted cleanup cannot purge the replacement admission', async () => {
        const controller = new AbortController();
        const baseDependencies = createAdmissionDependencies();
        let rejectFirstFetch: (reason: unknown) => void = () => {};
        let firstFetchPending = true;
        const firstDependencies = createAdmissionDependencies({
            fetchArtifact: vi.fn(async (url, signal) => {
                if (firstFetchPending) {
                    firstFetchPending = false;
                    return new Promise<Response>((_resolve, reject) => {
                        rejectFirstFetch = reject;
                    });
                }
                return baseDependencies.fetchArtifact(url, signal);
            }),
        });
        const replacementDependencies = createAdmissionDependencies();
        const firstOutcome = admitWebLlmModelArtifacts(
            fixtureModel.modelId,
            { downloadConsent: true, signal: controller.signal },
            firstDependencies
        ).then(
            () => null,
            (error: unknown) => error
        );
        await vi.waitFor(() => expect(firstDependencies.fetchArtifact).toHaveBeenCalledTimes(1));

        controller.abort(new DOMException('cancelled', 'AbortError'));
        const replacement = admitWebLlmModelArtifacts(
            fixtureModel.modelId,
            { downloadConsent: true },
            replacementDependencies
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        const replacementOverlappedCleanup = vi.mocked(replacementDependencies.fetchArtifact).mock.calls.length > 0;
        rejectFirstFetch(controller.signal.reason);

        await expect(firstOutcome).resolves.toMatchObject({ name: 'AbortError' });
        await expect(replacement).resolves.toMatchObject({ artifactSetDigest: fixtureModel.artifactSetDigest });
        expect(replacementOverlappedCleanup).toBe(false);
        vi.mocked(replacementDependencies.fetchArtifact).mockClear();
        await expect(
            admitWebLlmModelArtifacts(fixtureModel.modelId, {}, replacementDependencies)
        ).resolves.toMatchObject({ artifactSetDigest: fixtureModel.artifactSetDigest });
        expect(replacementDependencies.fetchArtifact).not.toHaveBeenCalled();
    });

    it('builds WebLLM configuration only from the immutable admitted model record', () => {
        const appConfig = createWebLlmAppConfig(fixtureModel);
        const modelRecord = appConfig.model_list[0];
        expect(modelRecord).toBeDefined();
        expect(appConfig.cacheBackend).toBe('cache');
        expect(modelRecord?.model_id).toBe(fixtureModel.modelId);
        expect(modelRecord?.model).toBe(
            `${fixtureModel.modelSource.origin}/${fixtureModel.modelSource.repository}/resolve/${fixtureModel.modelSource.revision}/`
        );
        const modelLibrary = fixtureModel.artifacts.find((artifact) => artifact.kind === 'model-library');
        expect(modelLibrary).toBeDefined();
        if (!modelLibrary) {
            throw new Error('Fixture model library is required');
        }
        expect(modelRecord?.model_lib).toBe(getWebLlmArtifactUrl(fixtureModel, modelLibrary));
    });

    describe('refusing a model this machine cannot run', () => {
        const LIGHT = 'Qwen3-1.7B-q4f16_1-MLC';
        const STANDARD = 'Qwen3-4B-q4f16_1-MLC';
        const encoder = new TextEncoder();

        // The shipped ids and digests with fixture-sized artifacts at addresses of their own, so two
        // models can be downloaded, cached and loaded in one test without fetching gigabytes.
        function modelFor(modelId: string): WebLlmArtifactManifestModel {
            const shipped = getWebLlmArtifactManifestModel(modelId);
            return {
                ...fixtureModel,
                modelId,
                artifactSetDigest: shipped.artifactSetDigest,
                modelSource: { ...fixtureModel.modelSource, repository: `mlc-ai/${modelId}` },
                wasmSource: { ...fixtureModel.wasmSource, repository: `mlc-ai/${modelId}-libs` },
                engine: shipped.engine,
            };
        }

        const downloadBytes = fixtureModel.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0);

        function artifactDependencies(
            overrides: Partial<WebLlmArtifactAdmissionDependencies> = {}
        ): WebLlmArtifactAdmissionDependencies {
            const models = [modelFor(LIGHT), modelFor(STANDARD)];
            return createAdmissionDependencies({
                getManifestModel: modelFor,
                fetchArtifact: vi.fn(async (url: string) => {
                    for (const model of models) {
                        const artifact = model.artifacts.find(
                            (candidate) => getWebLlmArtifactUrl(model, candidate) === url
                        );
                        if (artifact) {
                            return new Response(encoder.encode(fixtureContents.get(artifact.path)), { status: 200 });
                        }
                    }
                    return new Response(null, { status: 404 });
                }),
                sha256: vi.fn(async (bytes: ArrayBuffer) => {
                    const content = new TextDecoder().decode(bytes);
                    const model = models.find((candidate) => content === serializeWebLlmArtifactSet(candidate));
                    return model?.artifactSetDigest ?? fixtureDigests.get(content) ?? '0'.repeat(64);
                }),
                ...overrides,
            });
        }

        function loader(dependencies: WebLlmArtifactAdmissionDependencies): typeof initWebLlmEngine {
            return injectDependencies(initWebLlmEngine, {
                logger,
                admitWebLlmModelArtifacts: (
                    modelId: string,
                    options: Parameters<typeof admitWebLlmModelArtifacts>[1]
                ) => admitWebLlmModelArtifacts(modelId, options, dependencies),
                readWebGpuAdapterFeatures: async () => {
                    const adapter = await requestAdapterMock();
                    return adapter === null ? null : adapter.features;
                },
            });
        }

        function cachedEntryCount(): number {
            return Array.from(cacheEntries.entries())
                .filter(([name]) => name.startsWith('webllm/'))
                .reduce((total, [, entries]) => total + entries.size, 0);
        }

        it('names shader-f16 for q4f16 models only, from the id', () => {
            expect(getWebLlmRequiredFeatures(LIGHT)).toEqual(['shader-f16']);
            expect(getWebLlmRequiredFeatures('Qwen3-8B-q4f32_1-MLC')).toEqual([]);
            expect(getWebLlmRequiredFeatures('test-model')).toEqual([]);
        });

        it('sets the same required features on every shipped model record', () => {
            for (const selectableModel of WEBLLM_MODELS) {
                const record = createWebLlmAppConfig(getWebLlmArtifactManifestModel(selectableModel.id)).model_list[0];
                expect(record?.required_features, selectableModel.id).toEqual(['shader-f16']);
            }
        });

        it('refuses a model needing shader-f16 on an adapter without it, before any fetch, cache write or worker', async () => {
            requestAdapterMock.mockResolvedValue({ features: new Set() });
            const dependencies = artifactDependencies();

            await expect(loader(dependencies)(LIGHT, { downloadConsent: true })).rejects.toMatchObject({
                name: 'LocalModelRefusalError',
                refusal: { reason: 'shader-f16-unavailable', modelId: LIGHT },
            });

            expect(dependencies.fetchArtifact).not.toHaveBeenCalled();
            expect(workerSpawns).toEqual([]);
            expect(cacheEntries.size).toBe(0);
            expect(llmStatusStore.value).toMatchObject({
                state: 'error',
                refusal: { reason: 'shader-f16-unavailable', modelId: LIGHT },
                message: expect.stringContaining('shader-f16'),
            });
        });

        it('leaves a machine with no adapter to the existing WebGPU path rather than refusing it here', async () => {
            requestAdapterMock.mockResolvedValue(null);

            await expect(loader(artifactDependencies())(LIGHT, { downloadConsent: true })).resolves.toBeDefined();
        });

        it('refuses a download larger than the origin has room for, stating both figures, before any fetch', async () => {
            const dependencies = artifactDependencies({
                estimateStorage: async () => ({ quota: downloadBytes, usage: 1 }),
            });

            await expect(loader(dependencies)(LIGHT, { downloadConsent: true })).rejects.toMatchObject({
                name: 'LocalModelRefusalError',
                refusal: {
                    reason: 'insufficient-storage',
                    modelId: LIGHT,
                    requiredBytes: downloadBytes,
                    availableBytes: downloadBytes - 1,
                },
            });

            expect(dependencies.fetchArtifact).not.toHaveBeenCalled();
            expect(workerSpawns).toEqual([]);
            expectFixtureCachesEmpty();
            expect(llmStatusStore.value).toMatchObject({ state: 'error', refusal: { reason: 'insufficient-storage' } });
        });

        it('reclaims an interrupted download before estimating, so its staging bytes never cause a refusal', async () => {
            const stagingName = `sourdaw/webllm/staging-v1/${encodeURIComponent(LIGHT)}`;
            cacheEntries.set(stagingName, new Map([['stale-shard', new Response('stale')]]));
            const dependencies = artifactDependencies({
                estimateStorage: async () => ({ quota: downloadBytes, usage: cacheEntries.has(stagingName) ? 1 : 0 }),
            });

            await expect(loader(dependencies)(LIGHT, { downloadConsent: true })).resolves.toBeDefined();
            expect(dependencies.fetchArtifact).toHaveBeenCalled();
        });

        it('states a need above the room left as two different figures, even a byte apart', () => {
            const refusal = new LocalModelRefusalError({
                reason: 'insufficient-storage',
                modelId: LIGHT,
                requiredBytes: 1_000_000_001,
                availableBytes: 1_000_000_000,
            });

            expect(refusal.message).toContain('needs 1.01 GB to download, but this browser has 1.00 GB of storage left');
        });

        it('admits a download that exactly fits the remaining storage', async () => {
            const dependencies = artifactDependencies({
                estimateStorage: async () => ({ quota: downloadBytes + 10, usage: 10 }),
            });

            await expect(loader(dependencies)(LIGHT, { downloadConsent: true })).resolves.toBeDefined();
        });

        it('asks for consent before it reads storage', async () => {
            const estimateStorage = vi.fn(async () => ({ quota: 1, usage: 0 }));

            await expect(
                loader(artifactDependencies({ estimateStorage }))(LIGHT, { downloadConsent: false })
            ).rejects.toThrow(/explicit.*consent/i);

            expect(estimateStorage).not.toHaveBeenCalled();
        });

        it.each([
            ['throws', async () => Promise.reject(new Error('no estimate'))],
            ['reports no figures', async () => ({})],
        ])('proceeds with the download when the storage estimate %s', async (_label, estimateStorage) => {
            await expect(
                loader(artifactDependencies({ estimateStorage }))(LIGHT, { downloadConsent: true })
            ).resolves.toBeDefined();
        });

        it('loads an already cached model however little storage is left', async () => {
            const load = loader(artifactDependencies());
            await load(LIGHT, { downloadConsent: true });
            unloadWebLlmEngine();
            const dependencies = artifactDependencies({ estimateStorage: async () => ({ quota: 1, usage: 1 }) });

            await expect(loader(dependencies)(LIGHT)).resolves.toBeDefined();

            expect(dependencies.fetchArtifact).not.toHaveBeenCalled();
        });

        it('turns a device loss at load into a gpu-memory refusal, keeps the download and can load another model', async () => {
            const dependencies = artifactDependencies();
            const load = loader(dependencies);
            createWebWorkerEngineMock.mockRejectedValueOnce(
                'DeviceLostError: The WebGPU device was lost while loading the model. This can happen because of OOM.'
            );

            await expect(load(STANDARD, { downloadConsent: true })).rejects.toMatchObject({
                name: 'LocalModelRefusalError',
                refusal: { reason: 'gpu-memory', modelId: STANDARD },
                message: expect.stringContaining(
                    `needs ${WEBLLM_MODELS.find((model) => model.id === STANDARD)?.ramUsage ?? 'unknown'} of GPU memory`
                ),
            });

            await vi.waitFor(() => expect(engineState.initPromise).toBeNull());
            expect(llmStatusStore.value).toMatchObject({ state: 'error', refusal: { reason: 'gpu-memory' } });
            expect(workerSpawns).toHaveLength(1);
            expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
            expect(engineState.engine).toBeNull();
            expect(engineState.worker).toBeNull();
            const keptEntries = cachedEntryCount();
            expect(keptEntries).toBe(fixtureModel.artifacts.length);

            await expect(load(LIGHT, { downloadConsent: true })).resolves.toBeDefined();
            expect(workerSpawns).toHaveLength(2);
            expect(cachedEntryCount()).toBe(keptEntries * 2);

            vi.mocked(dependencies.fetchArtifact).mockClear();
            await expect(load(STANDARD)).resolves.toBeDefined();
            expect(dependencies.fetchArtifact).not.toHaveBeenCalled();
        });

        it.each([
            ['an out-of-memory text', 'RuntimeError: Out of memory while allocating the KV cache'],
            ['an OutOfMemory name', 'OutOfMemoryError: failed to allocate buffer'],
        ])('turns %s at load into a gpu-memory refusal', async (_label, failure) => {
            createWebWorkerEngineMock.mockRejectedValueOnce(failure);

            await expect(loader(artifactDependencies())(LIGHT, { downloadConsent: true })).rejects.toMatchObject({
                refusal: { reason: 'gpu-memory', modelId: LIGHT },
            });
        });

        it('classifies a load failure delivered as an Error, as a worker error event delivers it', async () => {
            createWebWorkerEngineMock.mockRejectedValueOnce(
                new Error('The WebGPU device was lost while loading the model: out of memory')
            );

            await expect(loader(artifactDependencies())(LIGHT, { downloadConsent: true })).rejects.toMatchObject({
                refusal: { reason: 'gpu-memory', modelId: LIGHT },
            });
        });

        it("maps web-llm's own missing-feature error to the shader-f16 refusal", async () => {
            createWebWorkerEngineMock.mockRejectedValueOnce('ShaderF16SupportError: This model requires shader-f16');

            await expect(loader(artifactDependencies())(LIGHT, { downloadConsent: true })).rejects.toMatchObject({
                refusal: { reason: 'shader-f16-unavailable', modelId: LIGHT },
            });
        });

        it('keeps any other load failure a plain error with no refusal', async () => {
            createWebWorkerEngineMock.mockRejectedValueOnce(new Error('network went away'));

            await expect(loader(artifactDependencies())(LIGHT, { downloadConsent: true })).rejects.toThrow(
                'network went away'
            );

            await vi.waitFor(() => expect(llmStatusStore.value).toMatchObject({ state: 'error' }));
            expect(llmStatusStore.value).not.toHaveProperty('refusal');
        });
    });
});
