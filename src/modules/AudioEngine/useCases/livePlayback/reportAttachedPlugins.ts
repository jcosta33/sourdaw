/**
 * Correct the devices of every instance a batch reported the engine took over.
 *
 * A plugin loaded before the engine was running is held by the command layer
 * with no engine behind it, and its device was told exactly that: loaded, and
 * passing silence. Nothing else ever revises that answer — the instance is
 * attached natively and processing audio, while the app still shows it degraded
 * for the rest of the session.
 *
 * Every apply, not only the one that starts the engine. A batch reserves ring
 * slots for the instances it counted and the native attach takes no more than
 * that, so an instance parked while a batch was in flight is taken by the next
 * one — within a single start sequence that is the roll, one batch behind the
 * topology. Which batch carries the correction is the native side's business;
 * this module's business is that no route drops it.
 */

import { markExternalPluginEngineAttached } from '#/modules/PluginHost/useCases';

import { type AudioGraphApplyResult } from '../../models/AudioGraphBackend';

export function reportAttachedPlugins(result: AudioGraphApplyResult): void {
    if (result.application !== 'applied') {
        return;
    }
    for (const attached of result.attachedPlugins ?? []) {
        markExternalPluginEngineAttached({
            instanceId: attached.instanceId,
            bridgeRoundTripFrames: attached.bridgeRoundTripFrames,
        });
    }
}
