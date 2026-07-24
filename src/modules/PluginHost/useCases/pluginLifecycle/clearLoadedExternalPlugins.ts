import { loadedExternalInstances } from './loadedExternalInstances';

/**
 * Drop every live-instance activation guard. Called when the audio graph is torn
 * down (project open/switch), so the next generation re-activates the incoming
 * project's persisted native plugins instead of treating them as already live.
 */
export function clearLoadedExternalPlugins(): void {
    loadedExternalInstances.clear();
}
