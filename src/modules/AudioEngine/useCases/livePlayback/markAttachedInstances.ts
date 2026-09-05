/**
 * Write the attach state a batch reported into PluginHost's mirror.
 *
 * Its own file so that the splice a report triggers can mark its own batch's
 * attachments without importing the reporter that triggers the splice. That
 * import would be a cycle, and `no-circular` is an error here.
 */

import { markExternalPluginEngineAttached } from '#/modules/PluginHost/useCases';

import { type AudioGraphApplyResult } from '../../models/AudioGraphBackend';

export function markAttachedInstances(result: AudioGraphApplyResult): void {
    if (result.application !== 'applied') {
        return;
    }
    for (const attached of result.attachedPlugins ?? []) {
        markExternalPluginEngineAttached({ instanceId: attached.instanceId });
    }
}
