import { logger } from '#/infra/logger/appLogger';

import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../stores/externalPluginActivationStore';

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
import { watchExternalPluginLatency } from './watchExternalPluginLatency';

type ActivateExternalPluginInput = {
    pluginId: string;
    instanceId: string;
    stateChunk?: string;
    /**
     * Sink for this instance's latency in MILLISECONDS (PH-4): the value read at
     * activation, and every runtime change the native host pushes afterwards.
     * Callers wire it to their latency registry keyed by engine device id;
     * injected rather than imported so this module keeps no AudioEngine edge.
     *
     * Milliseconds, not samples: the host converts at the rate the plugin was
     * activated with (the native device rate), which the webview's AudioContext
     * does not share.
     */
    onLatencyMs?: (latencyMs: number) => void;
};

function setActivationStatus(instanceId: string, status: 'loading' | 'active' | 'error', message?: string): void {
    externalPluginActivationStore.update((state) => {
        const current = state ?? defaultExternalPluginActivationState;
        return {
            ...current,
            byInstanceId: {
                ...current.byInstanceId,
                [instanceId]: message ? { status, message } : { status },
            },
        };
    });
}

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
    onLatencyMs,
}: ActivateExternalPluginInput): Promise<ExternalPluginActivationResult> {
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

    if (onLatencyMs) {
        // Register before the load so a latency change the plugin flags during
        // its very first activation still finds a sink, and make sure the single
        // push subscription is running.
        externalLatencyReporters.set(instanceId, onLatencyMs);
        watchExternalPluginLatency();
    }

    const activationTask = (async (): Promise<ExternalPluginActivationResult> => {
        let attachmentFailure: ExternalPluginActivationResult | null = null;
        try {
            const instance = await loadPlugin(pluginId, instanceId);
            if (instance.engine_plugin_id === null) {
                // Loaded, but no native engine was running to attach it to, so
                // it renders nothing. Recorded on the activation entry rather
                // than raised: this is the legitimate load-before-engine-start
                // flow, and failing it would break project open.
                const message = 'Loaded without a running native engine — this plugin processes no audio yet.';
                setActivationStatus(instanceId, 'active', message);
                logger.warn(`External plugin ${pluginId} instance ${instanceId}: ${message}`);
                attachmentFailure = { status: 'failed', stage: 'attach', reason: message };
            } else {
                setActivationStatus(instanceId, 'active');
            }
            // Report the latency read at activation (PH-4). loadPlugin always
            // resolves a PluginInstance with a numeric latency_ms (0 in the
            // browser stub), so no runtime guard is needed. Later changes arrive
            // through the plugin-latency-changed subscription instead.
            onLatencyMs?.(instance.latency_ms);
        } catch (error) {
            // Instantiation failed: drop the guard so a later rebuild can retry,
            // and the sink with it — nothing is live to report for.
            loadedExternalInstances.delete(instanceId);
            externalLatencyReporters.delete(instanceId);
            setActivationStatus(instanceId, 'error', String(error));
            logger.warn(`Failed to load external plugin ${pluginId} for instance ${instanceId}: ${String(error)}`);
            return { status: 'failed', stage: 'load', reason: String(error) };
        }

        if (!stateChunk) {
            return attachmentFailure ?? { status: 'active' };
        }
        try {
            await restorePluginState(instanceId, stateChunk);
            return attachmentFailure ?? { status: 'active' };
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
