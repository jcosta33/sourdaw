import { engineState } from './engineLifecycleState';
import { getWebLlmArtifactManifestModel } from './webLlmArtifactManifest';

/**
 * The context window, in tokens, a WebLLM model loads with. The release manifest owns the value:
 * the engine loads with it and the planning budget measures requests against it, so the two
 * cannot disagree.
 */
export function getWebLlmContextWindowSize(modelId: string = engineState.activeModelId): number {
    return getWebLlmArtifactManifestModel(modelId).engine.contextWindowSize;
}
