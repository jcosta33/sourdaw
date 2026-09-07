import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import {
    hasUnresolvedExternalPluginRestoreFailure,
    readPluginState,
    shouldWarnExternalPluginRestoreFailure,
} from '#/modules/PluginHost/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { capturedNativePluginStateCache } from './capturedNativePluginStateCache';
import { warnedExternalPluginCaptureRejections } from './warnedExternalPluginCaptureRejections';

export type ExternalPluginCaptureOutcome = {
    /**
     * Plugins whose capture command was rejected before any project write
     * landed, so their live edit is NOT in project truth. The caller must not
     * treat the save as a clean success for those edits.
     */
    readonly rejectedPlugins: readonly string[];
};

type RejectedCapture = {
    readonly instanceId: string;
    readonly pluginName: string;
};

/**
 * Capture the live state chunk of every loaded native plugin into project truth
 * immediately before a save. For each `external-plugin` device with an instance
 * id, read the host's opaque chunk and commit it (base64) through
 * `executeAppAction`, so it rides the same CRDT write path as the rest of the
 * project and is restored when the instance is next reloaded.
 *
 * A plugin that is absent, failed to instantiate, or produced an empty chunk
 * yields '' from `readPluginState`; that case is skipped so the previously
 * stored chunk survives a round-trip through a machine without the plugin
 * (Decision 0003 — never overwrite saved plugin state on instantiation
 * failure).
 *
 * A plugin that instantiated but REJECTED its saved state stays loaded holding
 * its own defaults, so its get-state is not the user's data either. While that
 * failure stands unresolved, the stored chunk stays authoritative for the slot
 * and the host is not read at all; a later successful restore or an explicit
 * `setExternalPluginState` replacement (which pushes the chunk to the host)
 * clears the marker and capture resumes. The skip is never silent — but it
 * warns exactly once per failure episode: autosave ticks on a plugin that
 * keeps rejecting its chunk must not nag every 30 seconds, while a
 * resolved-then-refailed instance warns again.
 *
 * The write is gated on whether THIS peer's own host state changed since its last
 * capture (`capturedNativePluginStateCache`), not on whether the stored chunk
 * differs. Under collaboration a sync can replace the stored chunk with a peer's
 * value; comparing against the store alone would re-commit the local chunk every
 * autosave tick while the peer did the reverse — an endless ping-pong. Comparing
 * against the self-read baseline makes "host unchanged" a guaranteed no-write.
 *
 * The baseline advances only once the command machinery reports the capture as
 * accepted — committed (including a committed-but-observer-error, where truth
 * holds the chunk even though post-commit processing failed) or needing no
 * write at all. A PRECOMMIT rejection wrote nothing, so the baseline stays
 * untouched and the next save retries the capture even when the host reads an
 * unchanged chunk; the rejected plugin is returned to the caller and named in a
 * warning, once per failed-capture episode.
 *
 * Reads and commits are serialized per device so a slow host cannot flood the
 * IPC bridge and so each commit lands before the next read observes the store.
 */
export async function captureExternalPluginStates(): Promise<ExternalPluginCaptureOutcome> {
    const state = trackStore.value;
    if (!state) {
        return { rejectedPlugins: [] };
    }

    const preservedPlugins: string[] = [];
    const rejectedCaptures: RejectedCapture[] = [];
    for (const track of state.tracks) {
        for (const device of track.devices) {
            const instanceId = device.externalInstanceId;
            if (device.type !== 'external-plugin' || !instanceId) {
                continue;
            }

            // The plugin rejected its saved state, so its current runtime state
            // is defaults. Preserve the stored original chunk by leaving the
            // slot untouched until authoritative state exists again — and say
            // so, once per failure episode: a save that silently drops the
            // plugin's edits reads as success to the musician, but an autosave
            // that nags every 30 seconds is noise.
            if (hasUnresolvedExternalPluginRestoreFailure(instanceId)) {
                if (shouldWarnExternalPluginRestoreFailure(instanceId)) {
                    preservedPlugins.push(device.externalPluginId ?? device.name);
                }
                continue;
            }

            let stateChunk: string;
            try {
                stateChunk = await readPluginState(instanceId);
            } catch {
                // A failed read must not clobber the stored chunk (missing/failed plugin).
                continue;
            }

            if (stateChunk.length === 0) {
                continue;
            }

            // Self-referential skip: our own host state is unchanged since the last
            // capture for this instance, so there is nothing local to persist —
            // regardless of what a collaboration sync wrote into the store.
            if (stateChunk === capturedNativePluginStateCache.get(instanceId)) {
                continue;
            }

            // Project truth already holds our host state — nothing to write. The
            // read still becomes the baseline: after a sync replaces the stored
            // chunk, an unchanged host must keep skipping rather than re-commit
            // our chunk over the peer's (collab ping-pong).
            if (stateChunk === device.externalStateChunk) {
                recordAcceptedCapture(instanceId, stateChunk);
                continue;
            }

            try {
                await executeAppAction(
                    { type: 'setExternalPluginState', payload: { deviceId: device.id, stateChunk } },
                    { skipMacroRecording: true }
                );
            } catch (error) {
                if (isAppActionCommittedError(error)) {
                    // The commit landed; only post-commit processing failed. The
                    // chunk is in project truth, so this capture counts as done
                    // and the unchanged-host skip keeps holding.
                    recordAcceptedCapture(instanceId, stateChunk);
                    continue;
                }
                // Precommit rejection: nothing was written, so the baseline stays
                // untouched and the next save retries the capture even though the
                // host will read the same chunk.
                rejectedCaptures.push({ instanceId, pluginName: device.externalPluginId ?? device.name });
                continue;
            }
            recordAcceptedCapture(instanceId, stateChunk);
        }
    }

    if (preservedPlugins.length > 0) {
        notifyUser(
            `Saved state was preserved for ${preservedPlugins.join(', ')} after a failed restore — edits made in the plugin since were not captured.`,
            'warning'
        );
    }

    warnOncePerEpisode(rejectedCaptures);

    return { rejectedPlugins: rejectedCaptures.map((rejection) => rejection.pluginName) };
}

/**
 * Record a capture the command machinery accepted — committed, or needing no
 * write at all. The baseline advances so unchanged-host saves keep skipping,
 * and a pending failed-capture episode for the instance ends.
 */
function recordAcceptedCapture(instanceId: string, stateChunk: string): void {
    capturedNativePluginStateCache.set(instanceId, stateChunk);
    warnedExternalPluginCaptureRejections.delete(instanceId);
}

function warnOncePerEpisode(rejectedCaptures: readonly RejectedCapture[]): void {
    const unwarned = rejectedCaptures.filter(
        (rejection) => !warnedExternalPluginCaptureRejections.has(rejection.instanceId)
    );
    for (const rejection of unwarned) {
        warnedExternalPluginCaptureRejections.add(rejection.instanceId);
    }
    if (unwarned.length === 0) {
        return;
    }
    notifyUser(
        `The latest state of ${unwarned.map((rejection) => rejection.pluginName).join(', ')} could not be saved — the project still reports unsaved changes, so save again to retry.`,
        'warning'
    );
}
