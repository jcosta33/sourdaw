/**
 * Retire one external plugin instance, and everything this process recorded
 * about it.
 *
 * ── What the native audio graph does with the hole ────────────────────────
 *
 * An unload drops the instance's parameter snapshot, so the live producer stops
 * reading it as attached (`readAttachedExternalInstanceIds`). What that means
 * for the running engine depends on where the session is.
 *
 * Parked, the release is the next play's topology batch: that batch replaces the
 * whole topology, and the strip it rebuilds names no effect for the unloaded
 * device, so nothing survives the fence.
 *
 * Rolling, nothing here reaches the graph. The engine's registry goes on naming
 * the freed effect until some later batch replaces the topology, and the
 * scheduler passes it through and counts it in the meantime. Releasing an
 * instance from a rolling graph needs a command that does not tear the topology
 * down, which is #3575's work; this module deliberately has no route to one.
 *
 * ── The mirror is retracted first, not last ───────────────────────────────
 *
 * The attachment is cleared *before* the unload is awaited, and the rest of the
 * instance's record only after it returns. The window between those two is real
 * — `resetExternalPluginRuntimeForGraphRebuild` unloads every instance while the
 * tracks keep their devices — and a play landing inside it would read a still
 * attached instance, claim a native body for that device, and have the mapper
 * refuse the whole batch when it cannot find the instance. Retracting early
 * under-reports instead: one strip degrades, and the session stands.
 */

import { unloadPlugin as unloadPluginRepo } from '../../repositories/pluginBridge/unloadPlugin';
import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../stores/externalPluginActivationStore';
import {
    dropExternalPluginParameterSnapshot,
    markEveryExternalPluginParameterSnapshotDetached,
    markExternalPluginParameterSnapshotDetached,
} from '../../stores/externalPluginParameterStore';
import { defaultPluginGuiState, pluginGuiStore } from '../../stores/pluginGuiStore';

import { externalBridgeFramesReporters } from './externalBridgeFramesReporters';
import { externalLatencyReporters } from './externalLatencyReporters';
import { externalPluginActivationOutcomes, externalPluginActivationTasks } from './externalPluginActivationTasks';
import { loadedExternalInstances } from './loadedExternalInstances';
import { serializePluginLifecycle } from './serializePluginLifecycle';

function forgetPluginInstance(instanceId: string): void {
    loadedExternalInstances.delete(instanceId);
    externalLatencyReporters.delete(instanceId);
    externalBridgeFramesReporters.delete(instanceId);
    externalPluginActivationTasks.delete(instanceId);
    externalPluginActivationOutcomes.delete(instanceId);
    // The parameters described an instance that no longer exists; leaving them
    // would keep offering automation targets for a destroyed plugin.
    dropExternalPluginParameterSnapshot(instanceId);
    externalPluginActivationStore.update((state) => {
        const byInstanceId = { ...(state ?? defaultExternalPluginActivationState).byInstanceId };
        delete byInstanceId[instanceId];
        return { ...(state ?? defaultExternalPluginActivationState), byInstanceId };
    });
    // Unloading destroys the editor window without the OS reporting a close, so
    // nothing else will ever retract an `isOpen` left standing here.
    pluginGuiStore.update((state) => {
        const byInstanceId = { ...(state ?? defaultPluginGuiState).byInstanceId };
        delete byInstanceId[instanceId];
        return { ...(state ?? defaultPluginGuiState), byInstanceId };
    });
}

function reconcileUnloadResult(
    result: Awaited<ReturnType<typeof unloadPluginRepo>>,
    expectedInstanceId?: string
): void {
    const mismatchedSuccess = expectedInstanceId !== undefined && result[0].some((id) => id !== expectedInstanceId);
    const missingOutcome = expectedInstanceId !== undefined && result[0].length === 0 && result[1].length === 0;
    if (mismatchedSuccess || missingOutcome) {
        throw new Error('Invalid keyed unload_plugin response');
    }
    for (const instanceId of result[0]) {
        forgetPluginInstance(instanceId);
    }
    if (result[1].length > 0) {
        throw new Error(result[1].join('; '));
    }
}

export function unloadPlugin(instanceId?: string): Promise<void> {
    if (instanceId === undefined) {
        markEveryExternalPluginParameterSnapshotDetached();
        return unloadPluginRepo().then(reconcileUnloadResult);
    }
    return serializePluginLifecycle(instanceId, async () => {
        if (!loadedExternalInstances.has(instanceId)) {
            return;
        }
        markExternalPluginParameterSnapshotDetached(instanceId);
        reconcileUnloadResult(await unloadPluginRepo(instanceId), instanceId);
    });
}
