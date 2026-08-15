import { getWebLlmArtifactUrl } from './getWebLlmArtifactUrl';
import { type WebLlmArtifactManifestModel } from './webLlmArtifactManifest';

import type { AppConfig, ModelRecord } from '@mlc-ai/web-llm';

function sha256HexToSri(sha256: string): string {
    const bytes = new Uint8Array(sha256.length / 2);
    for (let index = 0; index < sha256.length; index += 2) {
        bytes[index / 2] = Number.parseInt(sha256.slice(index, index + 2), 16);
    }
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return `sha256-${btoa(binary)}`;
}

export function createWebLlmAppConfig(model: WebLlmArtifactManifestModel): AppConfig {
    const configArtifact = model.artifacts.find((artifact) => artifact.kind === 'config');
    const wasmArtifact = model.artifacts.find((artifact) => artifact.kind === 'model-library');
    if (!configArtifact || !wasmArtifact) {
        throw new Error(`Incomplete WebLLM runtime artifacts for ${model.modelId}`);
    }
    const tokenizerIntegrity = Object.fromEntries(
        model.artifacts
            .filter((artifact) => artifact.kind === 'tokenizer')
            .map((artifact) => [artifact.path, sha256HexToSri(artifact.sha256)])
    );
    const modelRecord: ModelRecord = {
        model: `${model.modelSource.origin}/${model.modelSource.repository}/resolve/${model.modelSource.revision}/`,
        model_id: model.modelId,
        model_lib: getWebLlmArtifactUrl(model, wasmArtifact),
        vram_required_MB: model.engine.vramRequiredMb,
        low_resource_required: model.engine.lowResourceRequired,
        overrides: {
            context_window_size: model.engine.contextWindowSize,
        },
        integrity: {
            config: sha256HexToSri(configArtifact.sha256),
            model_lib: sha256HexToSri(wasmArtifact.sha256),
            tokenizer: tokenizerIntegrity,
            onFailure: 'error',
        },
    };
    return {
        cacheBackend: 'cache',
        model_list: [modelRecord],
    };
}
