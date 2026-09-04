import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../stores/externalPluginActivationStore';
import { markExternalPluginParameterSnapshotAttached } from '../../stores/externalPluginParameterStore';

import { externalBridgeFramesReporters } from './externalBridgeFramesReporters';

type MarkExternalPluginEngineAttachedInput = {
    instanceId: string;
    /**
     * What the engine that took this instance reports its audio bridge costs,
     * in frames of the rate the instance was activated with. The activation
     * reported zero because there was no bridge then; this is the real figure.
     */
    bridgeRoundTripFrames: number;
};

/**
 * Retract "this plugin processes no audio yet" for one instance the engine has
 * now taken.
 *
 * A plugin loaded before the first play is held by the native command layer with
 * no engine behind it, and the activation says so: the parameter snapshot
 * records `engineAttached: false` and the activation entry carries a message the
 * device shows. Nothing about the instance changes when an engine finally
 * starts — the same plugin, the same parameters — so this is the correction, not
 * a re-activation, and it must not disturb anything a plugin-side edit has
 * written since.
 *
 * Idempotent, and safe for an instance this process knows nothing about: every
 * write patches what is already there rather than creating it. Calling it for an
 * instance that was already attached leaves the stores untouched.
 */
export function markExternalPluginEngineAttached({
    instanceId,
    bridgeRoundTripFrames,
}: MarkExternalPluginEngineAttachedInput): void {
    markExternalPluginParameterSnapshotAttached(instanceId);

    externalPluginActivationStore.update((state) => {
        const current = state ?? defaultExternalPluginActivationState;
        const entry = current.byInstanceId[instanceId];
        // Only the degraded note this attach answers is cleared. An entry that
        // is loading, or that carries a real error, describes something this
        // report says nothing about.
        if (entry?.status !== 'active' || entry.message === undefined) {
            return current;
        }
        return {
            ...current,
            byInstanceId: { ...current.byInstanceId, [instanceId]: { status: 'active' } },
        };
    });

    // The caller's latency compensation was given zero at activation, because
    // an unattached instance crosses no bridge. This is the first moment the
    // real depth exists.
    externalBridgeFramesReporters.get(instanceId)?.(bridgeRoundTripFrames);
}
