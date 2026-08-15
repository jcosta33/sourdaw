import { type WebLlmArtifactManifestModel } from './webLlmArtifactManifest';

export function serializeWebLlmArtifactSet(model: WebLlmArtifactManifestModel): string {
    return JSON.stringify({
        modelId: model.modelId,
        modelSource: model.modelSource,
        wasmSource: model.wasmSource,
        engine: model.engine,
        artifacts: model.artifacts,
    });
}
