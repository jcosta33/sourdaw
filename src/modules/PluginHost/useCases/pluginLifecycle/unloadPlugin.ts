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
 * Rolling, no topology batch is coming, so the release is the native unload's
 * own: it takes every chain entry naming the instance out of the graph, in a
 * fenced batch of its own, before it retires the instance. The order is the
 * point. A chain entry naming a retired effect is a silent passthrough — the
 * scheduler's `run_device` returns on a failed effect-table lookup and counts
 * nothing — so an entry left standing would go unnoticed for the rest of the
 * session. Nothing dangles because nothing is retired while a chain still names
 * it.
 *
 * ── The mirror is retracted first, reconciled after ───────────────────────
 *
 * The attachment is cleared *before* the unload is awaited, and the rest of the
 * instance's record only after it returns. The window between those two is real
 * — `resetExternalPluginRuntimeForGraphRebuild` unloads every instance while the
 * tracks keep their devices — and a play landing inside it would read a still
 * attached instance, claim a native body for that device, and have the mapper
 * refuse the whole batch when it cannot find the instance. Retracting early
 * under-reports instead: one strip degrades, and the session stands.
 *
 * That retraction is a bet, so it is reconciled against what actually landed.
 * An unload can fail two ways and both keep the instance loaded *and* attached:
 * the native side reports it in the error list, where `cancel_unload` leaves it
 * in `engine_plugins`, or the bridge call rejects outright and nothing was ever
 * retired. A retraction left standing over either is permanent — no writer ever
 * sets the flag back, because activation short-circuits on an instance it
 * already holds and the engine reports only the dormant instances a batch newly
 * took — and it costs the plugin every automation lane on the audible path and
 * its whole parameter picker. The unkeyed unload retracts the entire session at
 * once, so one failed rebuild would do that to every loaded plugin.
 *
 * So a failed unload restores the attachments it captured. It restores the
 * whole captured set rather than reasoning about which leg failed: an instance
 * the unload *did* take has no snapshot left, and the restore skips an absent
 * one, so the same call is right whether nothing landed or only part of it did.
 *
 * ── Released strips report back through the sink ──────────────────────────
 *
 * The native reply also names every strip its own release touched, with that
 * strip's final chain — the release itself changed native state with no batch
 * of its own for a foreign mirror to read. This use case forwards those
 * reports to whatever `registerReleasedStripReportSink` wired up as soon as
 * the bridge reply carries any, ahead of the errors check below: the reports
 * describe native state that already committed, so their being forwarded does
 * not depend on whether some other instance in the same cascade also errored.
 */

import { unloadPlugin as unloadPluginRepo } from '../../repositories/pluginBridge/unloadPlugin';
import {
    externalPluginParameterStore,
    markEveryExternalPluginParameterSnapshotDetached,
    markExternalPluginParameterSnapshotDetached,
    markExternalPluginParameterSnapshotsAttached,
} from '../../stores/externalPluginParameterStore';

import { dropCarriedExternalPluginStates } from './carriedExternalPluginStates';
import { commitCarriedLiveStates } from './commitCarriedLiveStates';
import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';
import { forgetPluginInstance } from './forgetPluginInstance';
import { forwardReleasedStripReports } from './forwardReleasedStripReports';
import { loadedExternalInstances } from './loadedExternalInstances';
import { readLiveStatesForTeardown } from './readLiveStatesForTeardown';
import { serializePluginLifecycle } from './serializePluginLifecycle';

function reconcileUnloadResult(
    result: Awaited<ReturnType<typeof unloadPluginRepo>>,
    expectedInstanceId?: string
): void {
    const mismatchedSuccess =
        expectedInstanceId !== undefined && result.unloadedInstanceIds.some((id) => id !== expectedInstanceId);
    const missingOutcome =
        expectedInstanceId !== undefined && result.unloadedInstanceIds.length === 0 && result.errors.length === 0;
    if (mismatchedSuccess || missingOutcome) {
        throw new Error('Invalid keyed unload_plugin response');
    }
    for (const instanceId of result.unloadedInstanceIds) {
        forgetPluginInstance(instanceId);
    }
    if (result.errors.length > 0) {
        throw new Error(result.errors.join('; '));
    }
}

/** The instances this unload is about to retract, as the mirror stands now. */
function attachedInstanceIds(instanceId?: string): ReadonlySet<string> {
    const byInstanceId = externalPluginParameterStore.value?.byInstanceId ?? {};
    if (instanceId !== undefined) {
        return new Set(byInstanceId[instanceId]?.engineAttached === true ? [instanceId] : []);
    }
    return new Set(
        Object.entries(byInstanceId)
            .filter(([, snapshot]) => snapshot.engineAttached)
            .map(([id]) => id)
    );
}

/**
 * Run one unload with the attach mirror retracted across it.
 *
 * Retract and restore are paired here so the happy path above stays a straight
 * line: the bet is placed, the unload is awaited, and only a failure pays it
 * back. See the header for why the whole captured set is restored rather than
 * the failed leg's share of it.
 */
async function unloadWithRetractedMirror(instanceId?: string): Promise<void> {
    const attached = attachedInstanceIds(instanceId);
    if (instanceId === undefined) {
        markEveryExternalPluginParameterSnapshotDetached();
    } else {
        markExternalPluginParameterSnapshotDetached(instanceId);
    }
    try {
        const unloaded = await unloadPluginRepo(instanceId);
        if (unloaded.reports.length > 0) {
            forwardReleasedStripReports(unloaded.reports);
        }
        reconcileUnloadResult(unloaded, instanceId);
    } catch (error) {
        markExternalPluginParameterSnapshotsAttached(attached);
        throw error;
    }
}

/** Run `unloadLoaded` on the instance's lifecycle turn, only while it is still loaded. */
function scheduleKeyedUnload(instanceId: string, unloadLoaded: () => Promise<void>): Promise<void> {
    externalPluginStateCaptureAuthority.invalidate(instanceId);
    return serializePluginLifecycle(instanceId, () => {
        if (!loadedExternalInstances.has(instanceId)) {
            return Promise.resolve();
        }
        return unloadLoaded();
    });
}

/**
 * Unload every instance and keep the carries, for a graph repair that commits
 * its own pre-teardown reads after the unload. Other whole-runtime unloads use
 * `unloadPlugin()`.
 */
export function unloadEveryPluginKeepingCarries(): Promise<void> {
    externalPluginStateCaptureAuthority.invalidateAll();
    return unloadWithRetractedMirror();
}

/**
 * Without an instance id this is the whole-runtime unload a project
 * replacement or session retirement runs: the outgoing project's carries go
 * with it, even when the unload fails, and the drop also fences any read batch
 * still in flight from committing into the incoming project.
 */
export function unloadPlugin(instanceId?: string): Promise<void> {
    if (instanceId !== undefined) {
        return scheduleKeyedUnload(instanceId, () => unloadWithRetractedMirror(instanceId));
    }
    return unloadEveryPluginKeepingCarries().finally(dropCarriedExternalPluginStates);
}

/**
 * Unload one instance the app will reactivate later — a removed device that
 * Undo restores, or a sibling a strip deactivation takes down — carrying its
 * live state to that reactivation. Other teardowns use `unloadPlugin`.
 */
export function unloadPluginCarryingLiveState(instanceId: string): Promise<void> {
    return scheduleKeyedUnload(instanceId, async () => {
        const reads = await readLiveStatesForTeardown([instanceId], 'inside-lifecycle');
        try {
            await unloadWithRetractedMirror(instanceId);
        } finally {
            commitCarriedLiveStates(reads, loadedExternalInstances.has(instanceId) ? [] : [instanceId]);
        }
    });
}
