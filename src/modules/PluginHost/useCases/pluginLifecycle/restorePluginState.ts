import { base64ToBytes } from '#/utils/base64';

import { setPluginState } from '../../repositories/pluginBridge/setPluginState';

import { serializePluginLifecycle } from './serializePluginLifecycle';

/**
 * Restore a native plugin instance's opaque state chunk from a base64 string.
 *
 * Serialized on the instance's lifecycle tail, so a restore issued right after
 * `loadPlugin` runs only once instantiation has settled — before the engine
 * processes audio through the instance. A blank chunk is a no-op; the repository
 * stubs out in browser dev mode (no Tauri).
 */
export function restorePluginState(instanceId: string, stateChunk: string): Promise<void> {
    return serializePluginLifecycle(instanceId, async () => {
        if (stateChunk.length === 0) {
            return;
        }
        const bytes = base64ToBytes(stateChunk);
        await setPluginState(instanceId, [...bytes]);
    });
}
