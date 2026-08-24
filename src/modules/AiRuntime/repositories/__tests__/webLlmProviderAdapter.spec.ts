import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WEBLLM_MODELS } from '../../models/ModelInfo';
import { createWebLlmAppConfig } from '../webLlm/createWebLlmAppConfig';
import { engineState } from '../webLlm/engineLifecycleState';
import { getWebLlmArtifactUrl } from '../webLlm/getWebLlmArtifactUrl';
import { initWebLlmEngine } from '../webLlm/initWebLlmEngine';
import { serializeWebLlmArtifactSet } from '../webLlm/serializeWebLlmArtifactSet';
import { unloadWebLlmEngine } from '../webLlm/unloadWebLlmEngine';
import { admitWebLlmModelArtifacts, type WebLlmArtifactAdmissionDependencies } from '../webLlm/webLlmArtifactAdmission';
import {
    getWebLlmArtifactManifestModel,
    type WebLlmArtifact,
    type WebLlmArtifactManifestModel,
} from '../webLlm/webLlmArtifactManifest';

const { createWebWorkerEngineMock, terminateWorkerMock } = vi.hoisted(() => ({
    createWebWorkerEngineMock: vi.fn(),
    terminateWorkerMock: vi.fn(),
}));

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

vi.mock('../llmWorker?worker', () => ({
    default: class MockLlmWorker {
        terminate(): void {
            terminateWorkerMock();
        }
    },
}));

describe('WebLLM provider artifact admission', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                gpu: {},
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
        unloadWebLlmEngine();
        engineState.activeModelId = 'Qwen3-4B-q4f16_1-MLC';
        engineState.activeArtifactSetDigest = null;
    });

    it('requires explicit model-download consent before a fresh artifact set can fetch or start a worker', async () => {
        await expect(
            initWebLlmEngine('Qwen3-1.7B-q4f16_1-MLC', {
                downloadConsent: false,
            })
        ).rejects.toThrow('Explicit model-download consent is required before WebLLM can fetch this artifact set.');

        expect(createWebWorkerEngineMock).not.toHaveBeenCalled();
        expect(terminateWorkerMock).not.toHaveBeenCalled();
    });

    it('rejects an unmanifested model before cache access or private worker creation', async () => {
        await expect(
            initWebLlmEngine('mutable-or-unknown-model', {
                downloadConsent: true,
            })
        ).rejects.toThrow('WebLLM model is not admitted by this Sourdaw release: mutable-or-unknown-model');

        expect(createWebWorkerEngineMock).not.toHaveBeenCalled();
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
});
