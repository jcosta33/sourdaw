import { describe, expect, it, vi } from 'vitest';

import { admitWebLlmModelArtifacts, type WebLlmArtifactAdmissionDependencies } from '../webLlmArtifactAdmission';
import { getWebLlmArtifactManifestModel, type WebLlmArtifactManifestModel } from '../webLlmArtifactManifest';

const MODEL_ID = 'Qwen3-1.7B-q4f16_1-MLC';

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

    it.each([
        ['an artifact sha256', { sha256: 'f'.repeat(64) }],
        ['an artifact size', { sizeBytes: getWebLlmArtifactManifestModel(MODEL_ID).artifacts[0]!.sizeBytes + 1 }],
    ])('refuses before touching storage when %s no longer matches the artifact-set digest', async (_name, change) => {
        const altered = withFirstArtifactChanged(getWebLlmArtifactManifestModel(MODEL_ID), change);
        const { dependencies, mocks } = createDependencies(altered);

        await expect(admitWebLlmModelArtifacts(MODEL_ID, { downloadConsent: true }, dependencies)).rejects.toThrow(
            `WebLLM release artifact-set digest mismatch for ${MODEL_ID}`
        );
        for (const mock of Object.values(mocks)) {
            expect(mock).not.toHaveBeenCalled();
        }
    });
});
