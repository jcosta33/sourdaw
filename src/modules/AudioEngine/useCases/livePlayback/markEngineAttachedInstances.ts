/**
 * Write into PluginHost's mirror that the engine holds each of these instances.
 *
 * The one writer of that fact on this side, whichever route reported it: an
 * applied batch's `attachedPlugins` or the native host's own re-attach event.
 */

import { markExternalPluginEngineAttached } from '#/modules/PluginHost/useCases';

import { type AudioGraphAttachedPlugin } from '../../models/AudioGraphBackend';

export function markEngineAttachedInstances(attached: readonly AudioGraphAttachedPlugin[]): void {
    for (const plugin of attached) {
        markExternalPluginEngineAttached({ instanceId: plugin.instanceId });
    }
}
