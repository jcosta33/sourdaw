import { bytesToBase64 } from '#/utils/base64';

import { getPluginState } from '../../repositories/pluginBridge/getPluginState';

import { serializePluginLifecycle } from './serializePluginLifecycle';

/**
 * Read a loaded native plugin instance's opaque state chunk as a base64 string.
 *
 * Runs on the instance's lifecycle tail so it never races an in-flight load or
 * unload. Returns '' when the instance carries no state — absent from the host,
 * browser dev mode (no desktop bridge), or an empty chunk — which callers treat as
 * "preserve whatever chunk is already stored" rather than "clear it".
 */
export function readPluginState(instanceId: string): Promise<string> {
    return serializePluginLifecycle(instanceId, async () => {
        const bytes = await getPluginState(instanceId);
        if (bytes.length === 0) {
            return '';
        }
        return bytesToBase64(bytes);
    });
}
