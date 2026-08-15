import { type WebLlmArtifact, type WebLlmArtifactManifestModel } from './webLlmArtifactManifest';

export function getWebLlmArtifactUrl(model: WebLlmArtifactManifestModel, artifact: WebLlmArtifact): string {
    const source = artifact.source === 'model' ? model.modelSource : model.wasmSource;
    const route =
        artifact.source === 'model'
            ? `/${source.repository}/resolve/${source.revision}/${artifact.path}`
            : `/${source.repository}/${source.revision}/${artifact.path}`;
    return new URL(route, source.origin).href;
}
