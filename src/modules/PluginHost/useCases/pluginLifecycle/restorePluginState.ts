import { base64ToBytes } from '#/utils/base64';

import { setPluginState } from '../../repositories/pluginBridge/setPluginState';

import { serializePluginLifecycle } from './serializePluginLifecycle';

/**
 * Restore a native plugin instance's opaque state chunk from a base64 string.
 *
 * Serialized on the instance's lifecycle tail, so a restore issued right after
 * `loadPlugin` runs only once instantiation has settled. It is queued immediately
 * after instantiation, NOT synchronized with the first audio block — a running
 * native engine can process a few default-state blocks before this IPC lands. A
 * blank chunk is a no-op; the repository stubs out in browser dev mode (no desktop bridge).
 */
export function restorePluginState(instanceId: string, stateChunk: string): Promise<void> {
    return serializePluginLifecycle(instanceId, async () => {
        if (stateChunk.length === 0) {
            return;
        }
        await setPluginState(instanceId, base64ToBytes(stateChunk));
    });
}
