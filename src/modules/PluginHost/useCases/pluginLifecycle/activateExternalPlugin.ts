import { logger } from '#/infra/logger/appLogger';

import { writeExternalPluginParameterSnapshot } from '../../stores/externalPluginParameterStore';

import { setActivationStatus } from './activationStatus';
import { externalBridgeFramesReporters } from './externalBridgeFramesReporters';
import { externalLatencyReporters } from './externalLatencyReporters';
import {
    externalPluginActivationEpoch,
    externalPluginActivationOutcomes,
    externalPluginActivationTasks,
    type ExternalPluginActivationResult,
} from './externalPluginActivationTasks';
import { loadedExternalInstances } from './loadedExternalInstances';
import { loadPlugin } from './loadPlugin';
import { restorePluginState } from './restorePluginState';
import { pluginLifecycleScheduler } from './serializePluginLifecycle';
import { toExternalPluginParameters } from './toExternalPluginParameters';
import { watchExternalPluginLatency } from './watchExternalPluginLatency';
import { watchExternalPluginParameterEvents } from './watchExternalPluginParameterEvents';
import { watchExternalPluginParameterRescan } from './watchExternalPluginParameterRescan';

type ActivateExternalPluginInput = {
    pluginId: string;
    instanceId: string;
    stateChunk?: string;
    /**
     * The sample rate of the engine whose audio this instance will process.
     *
     * The plugin is activated at this rate and every samples→ms conversion the
     * host makes for it is against this rate, because this is the clock the
     * audio it is fed was rendered on. The host used to pick the output
     * device's own default instead, which is a different number on any machine
     * whose device is not running at the engine rate.
     *
     * Supplied by the caller rather than read here: this module keeps no
     * AudioEngine edge, for the same reason `onLatencyMs` is injected.
     */
    engineSampleRate: number;
    /**
     * Sink for this instance's latency in MILLISECONDS (PH-4): the value read at
     * activation, and every runtime change the native host pushes afterwards.
     * Callers wire it to their latency registry keyed by engine device id;
     * injected rather than imported so this module keeps no AudioEngine edge.
     *
     * Milliseconds, not samples: the host converts at the rate the plugin was
     * activated with, and reports the same figure again over the runtime
     * latency-change event, which carries no rate for a caller to divide by.
     */
    onLatencyMs?: (latencyMs: number) => void;
    /**
     * Sink for what the native audio bridge costs this instance, in frames of
     * `engineSampleRate`. Reported once at activation, alongside the plugin's
     * own latency, because the two are compensated together.
     *
     * Temporary, with the bridge: jcosta33/sourdaw#2230 replaces the worklet
     * relay with the native graph, and this sink goes with it.
     */
    onBridgeRoundTripFrames?: (frames: number) => void;
};

/**
 * Instantiate a native plugin in the live audio graph and restore its persisted
 * state chunk — exactly once per graph generation. This is the single activation
 * entry point for both interactive adds and the project-open rebuild.
 *
 * Idempotent: a call for an instance already live returns immediately, so the
 * post-open rebuild and every Play/record (all route through `ensureTrackStrips`)
 * do not re-issue load/restore IPC for a plugin that is already loaded.
 *
 * The restore is queued immediately after instantiation on the same lifecycle
 * tail — it is NOT synchronized with the first audio block. A running native
 * engine can process a few default-state blocks before the restore IPC lands
 * (`add_plugin_with_bridge` enqueues to the RT ring before the restore command
 * returns); state converges to the saved chunk shortly after.
 */
export function activateExternalPlugin({
    pluginId,
    instanceId,
    stateChunk,
    engineSampleRate,
    onLatencyMs,
    onBridgeRoundTripFrames,
}: ActivateExternalPluginInput): Promise<ExternalPluginActivationResult> {
    const rebuildCompletion = pluginLifecycleScheduler.currentRebuildCompletion();
    if (rebuildCompletion) {
        return rebuildCompletion.then(() =>
            activateExternalPlugin({
                pluginId,
                instanceId,
                stateChunk,
                engineSampleRate,
                onLatencyMs,
                onBridgeRoundTripFrames,
            })
        );
    }
    const activationEpoch = externalPluginActivationEpoch.current;
    const activeTask = externalPluginActivationTasks.get(instanceId);
    if (activeTask) {
        return activeTask;
    }
    if (loadedExternalInstances.has(instanceId)) {
        const priorOutcome = externalPluginActivationOutcomes.get(instanceId);
        if (priorOutcome?.status === 'failed' && priorOutcome.stage === 'restore' && stateChunk) {
            const restoreTask = restorePluginState(instanceId, stateChunk)
                .then((): ExternalPluginActivationResult => {
                    if (activationEpoch !== externalPluginActivationEpoch.current) {
                        return {
                            status: 'failed',
                            stage: 'restore',
                            reason: 'External plugin activation was superseded by a runtime graph rebuild',
                        };
                    }
                    setActivationStatus(instanceId, 'active');
                    return { status: 'active' };
                })
                .catch((error: unknown): ExternalPluginActivationResult => {
                    const reason = String(error);
                    setActivationStatus(instanceId, 'error', reason);
                    logger.warn(
                        `Failed to restore state for external plugin ${pluginId} instance ${instanceId}: ${reason}`
                    );
                    return { status: 'failed', stage: 'restore', reason };
                })
                .then((outcome) => {
                    if (
                        activationEpoch === externalPluginActivationEpoch.current &&
                        externalPluginActivationTasks.get(instanceId) === restoreTask
                    ) {
                        externalPluginActivationOutcomes.set(instanceId, outcome);
                        externalPluginActivationTasks.delete(instanceId);
                    }
                    return outcome;
                });
            externalPluginActivationTasks.set(instanceId, restoreTask);
            return restoreTask;
        }
        return Promise.resolve(priorOutcome ?? { status: 'active' });
    }
    loadedExternalInstances.add(instanceId);
    setActivationStatus(instanceId, 'loading');

    // Start before the load, for the same reason the latency sink is registered
    // before it: a plugin that opens its editor and is ridden during its own
    // first activation must not edit into a subscription that is not up yet.
    // Both are unconditional — every hosted plugin can be edited in its own
    // editor, and both subscriptions are one listener for the whole session.
    watchExternalPluginParameterEvents();
    watchExternalPluginParameterRescan();

    if (onLatencyMs) {
        // Register before the load so a latency change the plugin flags during
        // its very first activation still finds a sink, and make sure the single
        // push subscription is running.
        externalLatencyReporters.set(instanceId, onLatencyMs);
        watchExternalPluginLatency();
    }

    if (onBridgeRoundTripFrames) {
        // Registered the same way and for a longer reach: if no engine is
        // running, the real bridge cost is not known until one starts and takes
        // this instance over, which happens long after this call resolves.
        // `markExternalPluginEngineAttached` reports it through this sink.
        externalBridgeFramesReporters.set(instanceId, onBridgeRoundTripFrames);
    }

    const activationTask = (async (): Promise<ExternalPluginActivationResult> => {
        let attachment: ExternalPluginActivationResult | null = null;
        try {
            const instance = await loadPlugin(pluginId, instanceId, engineSampleRate);
            if (activationEpoch !== externalPluginActivationEpoch.current) {
                return {
                    status: 'failed',
                    stage: 'attach',
                    reason: 'External plugin activation was superseded by a runtime graph rebuild',
                };
            }
            // Publish what this instance reports about itself before anything
            // else reads it. The metadata is in hand here, so the automation
            // menu is populated without a second round trip; a plugin that
            // re-declares its parameters later is picked up by
            // `refreshExternalPluginParameters`.
            writeExternalPluginParameterSnapshot(instanceId, {
                engineAttached: instance.engine_plugin_id !== null,
                parameters: toExternalPluginParameters(instance.parameters),
            });
            if (instance.engine_plugin_id === null) {
                // Loaded, but no native engine was running to attach it to, so
                // it renders nothing yet. The first graph batch starts one and
                // takes this instance over, and `markExternalPluginEngineAttached`
                // clears the note below when it does — so this is a pending
                // attachment, not a failed one. Reporting it as failed made
                // every plugin loaded before the first play raise out of the
                // committed action that loaded it.
                const message = 'Loaded without a running native engine — this plugin processes no audio yet.';
                setActivationStatus(instanceId, 'active', message);
                logger.warn(`External plugin ${pluginId} instance ${instanceId}: ${message}`);
                attachment = { status: 'active', attachment: 'pending' };
            } else {
                setActivationStatus(instanceId, 'active');
            }
            // Report the latency read at activation (PH-4). loadPlugin always
            // resolves a PluginInstance with a numeric latency_ms (0 in the
            // browser stub), so no runtime guard is needed. Later changes arrive
            // through the plugin-latency-changed subscription instead.
            onLatencyMs?.(instance.latency_ms);
            // What the bridge costs on top of that. Reported here and only
            // here: the latency-change event carries the plugin's own figure,
            // and the bridge's depth does not change with it.
            onBridgeRoundTripFrames?.(instance.bridge_round_trip_frames);
        } catch (error) {
            // Instantiation failed: drop the guard so a later rebuild can retry,
            // and the sink with it — nothing is live to report for.
            loadedExternalInstances.delete(instanceId);
            externalLatencyReporters.delete(instanceId);
            externalBridgeFramesReporters.delete(instanceId);
            setActivationStatus(instanceId, 'error', String(error));
            logger.warn(`Failed to load external plugin ${pluginId} for instance ${instanceId}: ${String(error)}`);
            return { status: 'failed', stage: 'load', reason: String(error) };
        }

        if (!stateChunk) {
            return attachment ?? { status: 'active' };
        }
        try {
            await restorePluginState(instanceId, stateChunk);
            return attachment ?? { status: 'active' };
        } catch (error) {
            // Restore failure must not reload: the instance is loaded, so keep the
            // guard and only log — a later rebuild should not re-instantiate it.
            logger.warn(
                `Failed to restore state for external plugin ${pluginId} instance ${instanceId}: ${String(error)}`
            );
            setActivationStatus(instanceId, 'error', String(error));
            return { status: 'failed', stage: 'restore', reason: String(error) };
        }
    })().then((outcome) => {
        if (
            activationEpoch === externalPluginActivationEpoch.current &&
            externalPluginActivationTasks.get(instanceId) === activationTask
        ) {
            externalPluginActivationOutcomes.set(instanceId, outcome);
            externalPluginActivationTasks.delete(instanceId);
        }
        return outcome;
    });
    externalPluginActivationTasks.set(instanceId, activationTask);
    return activationTask;
}
