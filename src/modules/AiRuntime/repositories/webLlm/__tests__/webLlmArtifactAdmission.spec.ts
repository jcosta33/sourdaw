import { describe, expect, it, vi } from 'vitest';

import { LocalModelDownloadRequiredError } from '../../../errors/LocalModelDownloadRequiredError';
import { getWebLlmArtifactUrl } from '../getWebLlmArtifactUrl';
import { admitWebLlmModelArtifacts, type WebLlmArtifactAdmissionDependencies } from '../webLlmArtifactAdmission';
import { getWebLlmArtifactManifestModel, type WebLlmArtifactManifestModel } from '../webLlmArtifactManifest';

const MODEL_ID = 'Qwen3-1.7B-q4f16_1-MLC';
const PROVENANCE_URL = (digest: string) => `https://sourdaw.invalid/webllm/provenance/${digest}`;

// Mirrors the cache names the admission module stores each artifact kind under.
function cacheNameForKind(kind: string): string {
    if (kind === 'config') {
        return 'webllm/config';
    }
    return kind === 'model-library' ? 'webllm/wasm' : 'webllm/model';
}

/** One in-memory store behind every named cache, holding response bodies as text so each read is fresh. */
function createStoredCacheDependencies(model: WebLlmArtifactManifestModel, bodies: Map<string, string>) {
    const cache = {
        delete: async (request: string) => bodies.delete(request),
        keys: async () => [...bodies.keys()],
        match: async (request: string) => {
            const body = bodies.get(request);
            return body === undefined ? undefined : new Response(body);
        },
        put: async (request: string, response: Response) => {
            bodies.set(request, await response.text());
        },
    };
    const dependencies: WebLlmArtifactAdmissionDependencies = {
        deleteCache: vi.fn(async () => true),
        estimateStorage: vi.fn(async () => ({ quota: 1_000_000, usage: 0 })),
        fetchArtifact: vi.fn(async () => new Response(null, { status: 404 })),
        getManifestModel: () => model,
        openCache: async () => cache,
        runExclusive: (_lockName, _signal, operation) => operation(),
        sha256: webCryptoSha256,
    };
    return dependencies;
}

async function webCryptoSha256(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function withFirstArtifactChanged(
    model: WebLlmArtifactManifestModel,
    change: { sha256?: string; sizeBytes?: number }
): WebLlmArtifactManifestModel {
    const [first, ...rest] = model.artifacts;
    if (!first) {
        throw new Error(`manifest model ${model.modelId} has no artifacts`);
    }
    return { ...model, artifacts: [{ ...first, ...change }, ...rest] };
}

function createDependencies(model: WebLlmArtifactManifestModel) {
    const reachedStorage = new Error('reached storage');
    const mocks = {
        deleteCache: vi.fn(async () => true),
        estimateStorage: vi.fn(async () => ({ quota: 1_000_000, usage: 0 })),
        fetchArtifact: vi.fn(async () => new Response(null, { status: 404 })),
        openCache: vi.fn(async () => {
            throw reachedStorage;
        }),
    };
    const dependencies: WebLlmArtifactAdmissionDependencies = {
        ...mocks,
        getManifestModel: () => model,
        runExclusive: (_lockName, _signal, operation) => operation(),
        sha256: webCryptoSha256,
    };
    return { dependencies, mocks, reachedStorage };
}

describe('admitWebLlmModelArtifacts artifact-set digest binding', () => {
    it('admits past the digest check when the manifest entries hash to the recorded digest', async () => {
        const { dependencies, mocks, reachedStorage } = createDependencies(getWebLlmArtifactManifestModel(MODEL_ID));

        await expect(admitWebLlmModelArtifacts(MODEL_ID, { downloadConsent: true }, dependencies)).rejects.toBe(
            reachedStorage
        );
        expect(mocks.openCache).toHaveBeenCalledTimes(1);
    });

    const alterations = [
        ['an artifact sha256', { sha256: 'f'.repeat(64) }],
        ['an artifact size', { sizeBytes: getWebLlmArtifactManifestModel(MODEL_ID).artifacts[0]!.sizeBytes + 1 }],
    ] as const;
    const consentStates = [
        ['with download consent', { downloadConsent: true }],
        ['without download consent', {}],
    ] as const;

    it.each(
        alterations.flatMap(([alteration, change]) =>
            consentStates.map(([consent, options]) => [alteration, consent, change, options] as const)
        )
    )(
        'refuses before touching storage when %s no longer matches the artifact-set digest, %s',
        async (_alteration, _consent, change, options) => {
            const altered = withFirstArtifactChanged(getWebLlmArtifactManifestModel(MODEL_ID), change);
            const { dependencies, mocks } = createDependencies(altered);

            await expect(admitWebLlmModelArtifacts(MODEL_ID, options, dependencies)).rejects.toThrow(
                `WebLLM release artifact-set digest mismatch for ${MODEL_ID}`
            );
            for (const mock of Object.values(mocks)) {
                expect(mock).not.toHaveBeenCalled();
            }
        }
    );
});

describe('admitWebLlmModelArtifacts consent-required paths', () => {
    const model = getWebLlmArtifactManifestModel(MODEL_ID);

    it.each([
        {
            name: 'no provenance is recorded and no download consent is given',
            bodies: new Map<string, string>(),
            message: 'Explicit model-download consent is required before WebLLM can fetch this artifact set.',
        },
        {
            name: 'recorded provenance is invalid and is purged',
            bodies: new Map([[PROVENANCE_URL(model.artifactSetDigest), '{}']]),
            message:
                'WebLLM cache provenance was invalid and has been purged. Explicit consent is required to download it again.',
        },
        {
            name: 'valid provenance names artifacts the cache no longer holds',
            bodies: new Map([
                [
                    PROVENANCE_URL(model.artifactSetDigest),
                    JSON.stringify({
                        schemaVersion: 1,
                        modelId: model.modelId,
                        artifactSetDigest: model.artifactSetDigest,
                        artifacts: model.artifacts.map((artifact) => ({
                            cacheName: cacheNameForKind(artifact.kind),
                            url: getWebLlmArtifactUrl(model, artifact),
                        })),
                    }),
                ],
            ]),
            message:
                'Verified WebLLM cache was missing or poisoned and has been purged. Explicit consent is required to download it again.',
        },
    ])('throws LocalModelDownloadRequiredError when $name', async ({ bodies, message }) => {
        const dependencies = createStoredCacheDependencies(model, bodies);

        const rejection = await admitWebLlmModelArtifacts(MODEL_ID, {}, dependencies).then(
            () => null,
            (error: unknown) => error
        );

        expect(rejection).toBeInstanceOf(LocalModelDownloadRequiredError);
        expect(rejection).toHaveProperty('message', message);
    });
});
