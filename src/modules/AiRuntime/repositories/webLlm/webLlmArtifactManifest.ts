import rawManifest from './webLlmArtifactManifest.generated.json';

export type WebLlmArtifactKind = 'config' | 'model-library' | 'tokenizer' | 'weight-index' | 'weight-shard';

export type WebLlmArtifact = {
    kind: WebLlmArtifactKind;
    source: 'model' | 'wasm';
    path: string;
    sizeBytes: number;
    sha256: string;
};

type WebLlmArtifactSource = {
    origin: string;
    repository: string;
    revision: string;
};

export type WebLlmArtifactManifestModel = {
    modelId: string;
    artifactSetDigest: string;
    modelSource: WebLlmArtifactSource;
    wasmSource: WebLlmArtifactSource;
    engine: {
        contextWindowSize: number;
        vramRequiredMb: number;
        lowResourceRequired: boolean;
    };
    artifacts: readonly WebLlmArtifact[];
};

type WebLlmArtifactManifest = {
    schemaVersion: 1;
    releaseId: string;
    models: readonly WebLlmArtifactManifestModel[];
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
function isArtifactKind(value: unknown): value is WebLlmArtifactKind {
    return (
        value === 'config' ||
        value === 'model-library' ||
        value === 'tokenizer' ||
        value === 'weight-index' ||
        value === 'weight-shard'
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSource(value: unknown, expectedOrigin: string): WebLlmArtifactSource {
    if (
        !isRecord(value) ||
        value.origin !== expectedOrigin ||
        typeof value.repository !== 'string' ||
        !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value.repository) ||
        typeof value.revision !== 'string' ||
        !REVISION_PATTERN.test(value.revision)
    ) {
        throw new Error(`Invalid WebLLM artifact source for ${expectedOrigin}`);
    }
    return {
        origin: value.origin,
        repository: value.repository,
        revision: value.revision,
    };
}

function readArtifact(value: unknown): WebLlmArtifact {
    if (
        !isRecord(value) ||
        !isArtifactKind(value.kind) ||
        (value.source !== 'model' && value.source !== 'wasm') ||
        typeof value.path !== 'string' ||
        !SAFE_PATH_PATTERN.test(value.path) ||
        value.path.startsWith('/') ||
        value.path.split('/').includes('..') ||
        typeof value.sizeBytes !== 'number' ||
        !Number.isSafeInteger(value.sizeBytes) ||
        value.sizeBytes <= 0 ||
        typeof value.sha256 !== 'string' ||
        !SHA256_PATTERN.test(value.sha256)
    ) {
        throw new Error('Invalid WebLLM artifact manifest entry');
    }
    if ((value.kind === 'model-library') !== (value.source === 'wasm')) {
        throw new Error('WebLLM model-library source does not match its artifact kind');
    }
    return {
        kind: value.kind,
        source: value.source,
        path: value.path,
        sizeBytes: value.sizeBytes,
        sha256: value.sha256,
    };
}

function countKind(artifacts: readonly WebLlmArtifact[], kind: WebLlmArtifactKind): number {
    return artifacts.filter((artifact) => artifact.kind === kind).length;
}

function readModel(value: unknown): WebLlmArtifactManifestModel {
    if (
        !isRecord(value) ||
        typeof value.modelId !== 'string' ||
        value.modelId.length === 0 ||
        typeof value.artifactSetDigest !== 'string' ||
        !SHA256_PATTERN.test(value.artifactSetDigest) ||
        !isRecord(value.engine) ||
        typeof value.engine.contextWindowSize !== 'number' ||
        !Number.isSafeInteger(value.engine.contextWindowSize) ||
        value.engine.contextWindowSize <= 0 ||
        typeof value.engine.vramRequiredMb !== 'number' ||
        !Number.isFinite(value.engine.vramRequiredMb) ||
        value.engine.vramRequiredMb <= 0 ||
        typeof value.engine.lowResourceRequired !== 'boolean' ||
        !Array.isArray(value.artifacts)
    ) {
        throw new Error('Invalid WebLLM model artifact manifest');
    }
    const artifacts = value.artifacts.map(readArtifact);
    const uniquePaths = new Set(artifacts.map((artifact) => `${artifact.source}:${artifact.path}`));
    if (
        uniquePaths.size !== artifacts.length ||
        countKind(artifacts, 'config') !== 1 ||
        countKind(artifacts, 'weight-index') !== 1 ||
        countKind(artifacts, 'model-library') !== 1 ||
        countKind(artifacts, 'tokenizer') === 0 ||
        countKind(artifacts, 'weight-shard') === 0
    ) {
        throw new Error(`Incomplete WebLLM artifact set for ${value.modelId}`);
    }
    return {
        modelId: value.modelId,
        artifactSetDigest: value.artifactSetDigest,
        modelSource: readSource(value.modelSource, 'https://huggingface.co'),
        wasmSource: readSource(value.wasmSource, 'https://raw.githubusercontent.com'),
        engine: {
            contextWindowSize: value.engine.contextWindowSize,
            vramRequiredMb: value.engine.vramRequiredMb,
            lowResourceRequired: value.engine.lowResourceRequired,
        },
        artifacts,
    };
}

function readManifest(value: unknown): WebLlmArtifactManifest {
    if (
        !isRecord(value) ||
        value.schemaVersion !== 1 ||
        typeof value.releaseId !== 'string' ||
        value.releaseId.length === 0 ||
        !Array.isArray(value.models)
    ) {
        throw new Error('Unsupported WebLLM artifact manifest');
    }
    const models = value.models.map(readModel);
    if (new Set(models.map((model) => model.modelId)).size !== models.length) {
        throw new Error('Duplicate WebLLM model IDs in artifact manifest');
    }
    return {
        schemaVersion: 1,
        releaseId: value.releaseId,
        models,
    };
}

const manifest = readManifest(rawManifest);

export function getWebLlmArtifactManifestModel(modelId: string): WebLlmArtifactManifestModel {
    const model = manifest.models.find((candidate) => candidate.modelId === modelId);
    if (!model) {
        throw new Error(`WebLLM model is not admitted by this Sourdaw release: ${modelId}`);
    }
    return model;
}
