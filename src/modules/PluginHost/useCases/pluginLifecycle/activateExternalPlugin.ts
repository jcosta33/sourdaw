import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../stores/externalPluginActivationStore';
import { writeExternalPluginParameterSnapshot } from '../../stores/externalPluginParameterStore';
import { writeExternalPluginTail } from '../../stores/externalPluginTailStore';

import {
    carriedExternalPluginStateFence,
    carriedExternalPluginStates,
    type CarriedExternalPluginState,
} from './carriedExternalPluginStates';
import { clearExternalPluginRestoreFailure } from './clearExternalPluginRestoreFailure';
import { externalLatencyReporters } from './externalLatencyReporters';
import {
    externalPluginActivationEpoch,
    externalPluginActivationOutcomes,
    externalPluginActivationTasks,
    type ExternalPluginActivationResult,
} from './externalPluginActivationTasks';
import { loadedExternalInstancePluginIds, loadedExternalInstances } from './loadedExternalInstances';
import { loadPlugin } from './loadPlugin';
import { markExternalPluginRestoreFailure } from './markExternalPluginRestoreFailure';
import { pendingKeyedUnloadGenerations, pendingKeyedUnloads } from './pendingKeyedUnloads';
import { PENDING_UNLOAD_WAIT_TIMEOUT_MS } from './pendingUnloadWaitTimeout';
import { restorePluginState } from './restorePluginState';
import { pluginLifecycleScheduler } from './serializePluginLifecycle';
import { tailRevisionsDuringLoad } from './tailRevisionsDuringLoad';
import { toExternalPluginParameters } from './toExternalPluginParameters';
import { watchExternalPluginLatency } from './watchExternalPluginLatency';
import { watchExternalPluginParameterEvents } from './watchExternalPluginParameterEvents';
import { watchExternalPluginParameterRescan } from './watchExternalPluginParameterRescan';
import { watchExternalPluginTail } from './watchExternalPluginTail';

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
     * activated with, and reports the same figure again over the runtime
     * latency-change event, which carries no rate for a caller to divide by.
     */
    onLatencyMs?: (latencyMs: number) => void;
};

const SUPERSEDED_RESTORE: ExternalPluginActivationResult = {
    status: 'failed',
    stage: 'restore',
    reason: 'External plugin activation was superseded by a runtime teardown',
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
 * The live state a teardown carried for this instance, when it came from the
 * same plugin. Every activation advances the slot here, carry or not, so a
 * teardown read from before this activation cannot plant a carry on the
 * instance it brings back.
 */
function takeCarriedState(instanceId: string, pluginId: string): CarriedExternalPluginState | undefined {
    carriedExternalPluginStateFence.advanceSlot(instanceId);
    const carried = carriedExternalPluginStates.get(instanceId);
    if (carried === undefined) {
        return undefined;
    }
    if (carried.pluginId !== pluginId) {
        carriedExternalPluginStates.delete(instanceId);
        return undefined;
    }
    return carried;
}

/**
 * Restore carried live state into a fresh instance. A rejected carry is
 * dropped here; a restored one stays until the activation task settles (see
 * `releaseConsumedCarry`); one a later teardown overtook keeps it for the next
 * activation.
 */
async function restoreCarriedState(
    instanceId: string,
    pluginId: string,
    carried: CarriedExternalPluginState,
    isCurrentActivation: () => boolean
): Promise<'restored' | 'rejected' | 'superseded'> {
    let rejection: string | null = null;
    try {
        await restorePluginState(instanceId, carried.stateChunk);
    } catch (error) {
        rejection = String(error);
    }
    if (!isCurrentActivation()) {
        return 'superseded';
    }
    if (rejection === null) {
        clearExternalPluginRestoreFailure(instanceId);
        return 'restored';
    }
    carriedExternalPluginStates.delete(instanceId);
    carriedExternalPluginStateFence.advanceSlot(instanceId);
    logger.warn(`External plugin ${pluginId} instance ${instanceId} rejected its carried live state: ${rejection}`);
    notifyUser(`Unsaved edits in ${pluginId} could not be restored after the plugin was reloaded.`, 'warning');
    return 'rejected';
}

/**
 * Drop the carry a settled activation restored. While the activation task is
 * registered, a teardown read carries this entry forward instead of reading
 * the plugin (`readLiveStatesForTeardown`), so the entry outlives the restore
 * until the task settles. A teardown that landed meanwhile owns whatever the
 * store now holds, so only the very entry this activation consumed, on an
 * instance still loaded, is dropped.
 */
function releaseConsumedCarry(instanceId: string, consumed: CarriedExternalPluginState): void {
    if (loadedExternalInstances.has(instanceId) && carriedExternalPluginStates.get(instanceId) === consumed) {
        carriedExternalPluginStates.delete(instanceId);
    }
}

type PendingUnloadWait = 'settled' | 'timed-out';

/**
 * Ordering only: the unload's own outcome stays its caller's, so a rejection
 * counts as settled here. Bounded, because the native unload is not.
 */
function waitForPendingUnload(pendingUnload: Promise<void>): Promise<PendingUnloadWait> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = pendingUnload.then(
        (): PendingUnloadWait => 'settled',
        (): PendingUnloadWait => 'settled'
    );
    const deadline = new Promise<PendingUnloadWait>((resolve) => {
        timer = setTimeout(() => resolve('timed-out'), PENDING_UNLOAD_WAIT_TIMEOUT_MS);
    });
    return Promise.race([settled, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Activate once the queued unload of the same instance settles, so the
 * activation reflects the instance the unload leaves. An unload still pending
 * at the deadline keeps the instance and its pending entry; a later activation
 * waits again. A later unload of the instance or a runtime rebuild admitted
 * during the wait decided the instance's fate instead, so the waiter does not
 * reload: reloading would leave a plugin loaded that nothing in the project
 * holds (Remove, Undo, Redo).
 */
async function activateAfterPendingUnload(
    input: ActivateExternalPluginInput,
    pendingUnload: Promise<void>
): Promise<ExternalPluginActivationResult> {
    const unloadGeneration = pendingKeyedUnloadGenerations.get(input.instanceId);
    const activationEpoch = externalPluginActivationEpoch.current;
    if ((await waitForPendingUnload(pendingUnload)) === 'settled') {
        if (
            pendingKeyedUnloadGenerations.get(input.instanceId) !== unloadGeneration ||
            externalPluginActivationEpoch.current !== activationEpoch
        ) {
            return {
                status: 'failed',
                stage: 'load',
                reason: 'External plugin activation was superseded by a later unload',
            };
        }
        return activateExternalPlugin(input);
    }
    const reason = `${input.pluginId} is still unloading and did not finish; it was not reactivated.`;
    setActivationStatus(input.instanceId, 'error', reason);
    logger.warn(`Failed to reactivate external plugin ${input.pluginId} for instance ${input.instanceId}: ${reason}`);
    return { status: 'failed', stage: 'load', reason };
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
 * (`add_hosted_plugin` enqueues to the RT ring before the restore command
 * returns); state converges to the saved chunk shortly after.
 */
export function activateExternalPlugin({
    pluginId,
    instanceId,
    stateChunk,
    onLatencyMs,
}: ActivateExternalPluginInput): Promise<ExternalPluginActivationResult> {
    const rebuildCompletion = pluginLifecycleScheduler.currentRebuildCompletion();
    if (rebuildCompletion) {
        return rebuildCompletion.then(() =>
            activateExternalPlugin({
                pluginId,
                instanceId,
                stateChunk,
                onLatencyMs,
            })
        );
    }
    const pendingUnload = pendingKeyedUnloads.get(instanceId);
    if (pendingUnload) {
        return activateAfterPendingUnload({ pluginId, instanceId, stateChunk, onLatencyMs }, pendingUnload);
    }
    const activationEpoch = externalPluginActivationEpoch.current;
    const activeTask = externalPluginActivationTasks.get(instanceId);
    if (activeTask) {
        return activeTask;
    }
    if (loadedExternalInstances.has(instanceId)) {
        const priorOutcome = externalPluginActivationOutcomes.get(instanceId);
        if (priorOutcome?.status === 'failed' && priorOutcome.stage === 'restore' && stateChunk) {
            // A rebuild ends the graph generation before it waits on this retry; an engine retire
            // forgets the instance, and its task with it, without ending the generation.
            function isCurrentRestore(): boolean {
                return (
                    activationEpoch === externalPluginActivationEpoch.current &&
                    externalPluginActivationTasks.get(instanceId) === restoreTask
                );
            }
            const restoreTask = restorePluginState(instanceId, stateChunk)
                .then((): ExternalPluginActivationResult => {
                    if (!isCurrentRestore()) {
                        return SUPERSEDED_RESTORE;
                    }
                    setActivationStatus(instanceId, 'active');
                    // The saved chunk is in the plugin again, so what it reports
                    // over get-state is authoritative state.
                    clearExternalPluginRestoreFailure(instanceId);
                    return { status: 'active' };
                })
                .catch((error: unknown): ExternalPluginActivationResult => {
                    if (!isCurrentRestore()) {
                        return SUPERSEDED_RESTORE;
                    }
                    const reason = String(error);
                    setActivationStatus(instanceId, 'error', reason);
                    // The plugin rejected the chunk and holds its defaults; its
                    // runtime state must not reach a save until real state
                    // exists again.
                    markExternalPluginRestoreFailure(instanceId);
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
    loadedExternalInstancePluginIds.set(instanceId, pluginId);
    setActivationStatus(instanceId, 'loading');

    // Start before the load, for the same reason the latency sink is registered
    // before it: a plugin that opens its editor and is ridden during its own
    // first activation must not edit into a subscription that is not up yet.
    // Both are unconditional — every hosted plugin can be edited in its own
    // editor, and both subscriptions are one listener for the whole session.
    watchExternalPluginParameterEvents();
    watchExternalPluginParameterRescan();
    // Before the load for the same reason: a plugin that lengthens its tail
    // while it first activates must find the subscription already up.
    watchExternalPluginTail();

    if (onLatencyMs) {
        // Register before the load so a latency change the plugin flags during
        // its very first activation still finds a sink, and make sure the single
        // push subscription is running.
        externalLatencyReporters.set(instanceId, onLatencyMs);
        watchExternalPluginLatency();
    }

    // Engine retirement can forget this task without ending the graph
    // generation, and a successor can already hold the same instance ID.
    function isCurrentActivation(): boolean {
        return (
            activationEpoch === externalPluginActivationEpoch.current &&
            externalPluginActivationTasks.get(instanceId) === activationTask &&
            loadedExternalInstances.has(instanceId)
        );
    }

    let restoredCarry: CarriedExternalPluginState | undefined;
    const activationTask = (async (): Promise<ExternalPluginActivationResult> => {
        let attachment: ExternalPluginActivationResult | null = null;
        try {
            const instance = await loadPlugin(pluginId, instanceId);
            if (!isCurrentActivation()) {
                return {
                    status: 'failed',
                    stage: 'attach',
                    reason: 'External plugin activation was superseded by a runtime teardown',
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
            // What an export reserves after the last note for this instance's
            // decay; later revisions arrive over `plugin-tail-changed`. One the
            // plugin reported before this answer arrived is newer than it.
            writeExternalPluginTail(instanceId, tailRevisionsDuringLoad.get(instanceId) ?? instance.tail_samples);
            tailRevisionsDuringLoad.delete(instanceId);
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
        } catch (error) {
            const reason = String(error);
            if (isCurrentActivation()) {
                // Drop the guard so a later rebuild can retry, and the sink
                // with it since the instance never went live.
                loadedExternalInstances.delete(instanceId);
                loadedExternalInstancePluginIds.delete(instanceId);
                externalLatencyReporters.delete(instanceId);
                tailRevisionsDuringLoad.delete(instanceId);
                setActivationStatus(instanceId, 'error', reason);
            }
            logger.warn(`Failed to load external plugin ${pluginId} for instance ${instanceId}: ${reason}`);
            return { status: 'failed', stage: 'load', reason };
        }

        // No base-chunk check against the project chunk is needed: project
        // state changes under a live instance only through a `replacement`,
        // offered only while a failed-restore marker stands, and a marked
        // instance is never carried; a capture writes the live state itself.
        const carried = takeCarriedState(instanceId, pluginId);
        if (carried !== undefined) {
            const carriedRestore = await restoreCarriedState(instanceId, pluginId, carried, isCurrentActivation);
            if (carriedRestore === 'superseded') {
                return SUPERSEDED_RESTORE;
            }
            if (carriedRestore === 'restored') {
                restoredCarry = carried;
                return attachment ?? { status: 'active' };
            }
        }

        if (!stateChunk) {
            return attachment ?? { status: 'active' };
        }
        try {
            await restorePluginState(instanceId, stateChunk);
            if (!isCurrentActivation()) {
                return SUPERSEDED_RESTORE;
            }
            // The saved chunk is in the plugin again, so what it reports over
            // get-state is authoritative state.
            clearExternalPluginRestoreFailure(instanceId);
            return attachment ?? { status: 'active' };
        } catch (error) {
            // A teardown that overtook the load owns the instance now, and a newer activation may hold
            // the same id: this restore's outcome is no longer this instance's state.
            if (!isCurrentActivation()) {
                return SUPERSEDED_RESTORE;
            }
            // Restore failure must not reload: the instance is loaded, so keep the
            // guard and only log — a later rebuild should not re-instantiate it.
            setActivationStatus(instanceId, 'error', String(error));
            // The plugin rejected the chunk and holds its defaults; its runtime
            // state must not reach a save until real state exists again.
            markExternalPluginRestoreFailure(instanceId);
            logger.warn(
                `Failed to restore state for external plugin ${pluginId} instance ${instanceId}: ${String(error)}`
            );
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
        if (restoredCarry !== undefined) {
            releaseConsumedCarry(instanceId, restoredCarry);
        }
        return outcome;
    });
    externalPluginActivationTasks.set(instanceId, activationTask);
    return activationTask;
}
