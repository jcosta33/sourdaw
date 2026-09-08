import { logger } from '#/infra/logger/appLogger';
import {
    clearExternalPluginRestoreFailure,
    hasUnresolvedExternalPluginRestoreFailure,
    restorePluginState,
} from '#/modules/PluginHost/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';

import type { Track } from '../../models/Track';

type Device = Track['devices'][number];
export type SetExternalPluginStateInput = Extract<AppAction, { type: 'setExternalPluginState' }>['payload'];

/**
 * What one `setExternalPluginState` dispatch did.
 */
export type ExternalPluginStateWrite = {
    /** Project truth carries the chunk; false aborts the CRDT transaction as a no-write. */
    didWrite: boolean;
    /**
     * Present only when project truth was written AND the instance still carries
     * a failed-restore marker: the host still holds the defaults the plugin fell
     * back to, so the replacement must reach it before the next capture reads
     * the host. Run it after the owning transaction commits; it resolves once
     * the host accepted the chunk (the marker clears then). A rejected push is
     * logged and leaves the marker standing, so capture keeps preserving the
     * chunk in project truth and the next activation retry restores the
     * replacement from there.
     */
    pushReplacementToHost?: () => Promise<void>;
};

function findDeviceById(tracks: readonly Track[], deviceId: string): Device | undefined {
    for (const track of tracks) {
        const device = track.devices.find((candidate) => candidate.id === deviceId);
        if (device) {
            return device;
        }
    }
    return undefined;
}

function pushReplacementToHost(instanceId: string, stateChunk: string): () => Promise<void> {
    return async () => {
        try {
            await restorePluginState(instanceId, stateChunk);
        } catch (error) {
            // The plugin rejected the replacement just as it may have rejected
            // the original chunk: the marker stays, capture keeps preserving
            // project truth, and the next activation retry restores the
            // replacement from there.
            logger.warn(`Could not push replaced state to external plugin instance ${instanceId}: ${String(error)}`);
            return;
        }
        clearExternalPluginRestoreFailure(instanceId);
    };
}

/**
 * Persist a native plugin's opaque state chunk (base64) onto its device in
 * project truth. The authoritative mutation behind the `setExternalPluginState`
 * action: dispatched from the save flow so the chunk rides the CRDT write path
 * and is restored on the next load.
 *
 * When the instance still carries a failed-restore marker, the returned
 * `pushReplacementToHost` must run after the owning transaction commits (see
 * `ExternalPluginStateWrite`): a marker clear without the host push would leave
 * the plugin on its defaults while capture reads the host again.
 *
 * Returns `didWrite: false` when no device carries the id, so the handler
 * reports a no-write and the CRDT transaction aborts instead of committing an
 * empty diff.
 */
export function setExternalPluginState(input: SetExternalPluginStateInput): ExternalPluginStateWrite {
    const state = getTrackState();
    if (!state) {
        return { didWrite: false };
    }

    const device = findDeviceById(state.tracks, input.deviceId);
    if (!device) {
        return { didWrite: false };
    }

    if (
        input.intent === 'capture' &&
        (device.type !== 'external-plugin' ||
            device.externalInstanceId !== input.expectedInstanceId ||
            (device.externalStateChunk ?? null) !== input.expectedStateChunk ||
            hasUnresolvedExternalPluginRestoreFailure(input.expectedInstanceId))
    ) {
        return { didWrite: false };
    }

    mapAllTracks((track) => ({
        ...track,
        devices: track.devices.map((candidate) =>
            candidate.id === input.deviceId ? { ...candidate, externalStateChunk: input.stateChunk } : candidate
        ),
    }));

    if (input.intent === 'capture') {
        return { didWrite: true };
    }

    const instanceId = device.externalInstanceId;
    if (instanceId && hasUnresolvedExternalPluginRestoreFailure(instanceId)) {
        return { didWrite: true, pushReplacementToHost: pushReplacementToHost(instanceId, input.stateChunk) };
    }
    return { didWrite: true };
}
