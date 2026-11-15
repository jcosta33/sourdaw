import { undoHistoryStore } from '#/modules/Command/stores';
import { type DeviceSnapshot, type RestoreTrackPayloadSnapshot } from '#/utils/handlerContract';

import { type Device } from '../../models/Track';
import { decodeTrackSnapshot, type Track } from '../../stores/trackStore';

type DiscardedPluginStates = ReadonlyMap<string, string | undefined>;

// Held in memory only, so a reload between Undo and Redo restores the snapshot's chunk.
const discardedPluginStatesByUndoEntryId = new Map<string, DiscardedPluginStates>();

/** Drops the records of entries history no longer holds, so an undone creation never redone does not keep its chunks. */
function pruneRecordsOutsideHistory(): void {
    const history = undoHistoryStore.value;
    const liveEntryIds = new Set([...(history?.past ?? []), ...(history?.future ?? [])].map((entry) => entry.id));
    for (const undoEntryId of discardedPluginStatesByUndoEntryId.keys()) {
        if (!liveEntryIds.has(undoEntryId)) {
            discardedPluginStatesByUndoEntryId.delete(undoEntryId);
        }
    }
}

/**
 * Records each hosted device's plugin state as the discard of a created track saw it.
 * The redo snapshot was captured when the track was created, and a later save's
 * non-undoable capture moved the chunk past it; the discard guard does not compare the
 * chunk, so redo must not roll it back either.
 */
export function recordDiscardedPluginStates(undoEntryId: string, tracks: readonly Track[]): void {
    recordDiscardedDevicePluginStates(
        undoEntryId,
        tracks.flatMap((track) => track.devices)
    );
}

/**
 * Records each hosted device's plugin state as a removal saw it. A redone removal runs
 * with its recorded inverse unchanged, so the restore that undoes it again overlays
 * these chunks onto the snapshot the first run took.
 */
export function recordDiscardedDevicePluginStates(undoEntryId: string, devices: readonly DeviceSnapshot[]): void {
    pruneRecordsOutsideHistory();
    const states = new Map<string, string | undefined>();
    for (const device of devices) {
        if (device.externalPluginId !== undefined) {
            states.set(device.id, device.externalStateChunk);
        }
    }
    if (states.size === 0) {
        discardedPluginStatesByUndoEntryId.delete(undoEntryId);
        return;
    }
    discardedPluginStatesByUndoEntryId.set(undoEntryId, states);
}

function withRecordedState(device: Device, states: DiscardedPluginStates): Device {
    if (!states.has(device.id)) {
        return device;
    }
    const { externalStateChunk: _snapshotChunk, ...withoutChunk } = device;
    const recordedChunk = states.get(device.id);
    return recordedChunk === undefined ? withoutChunk : { ...withoutChunk, externalStateChunk: recordedChunk };
}

/**
 * Overlays the recorded plugin states onto a redo's restore snapshots. The record stays:
 * materialization runs before the redo is admitted, so a refused or rolled-back redo
 * must find it again on retry. `forgetDiscardedPluginStates` drops it once a redo commits.
 */
export function overlayDiscardedPluginStates(
    undoEntryId: string,
    restores: readonly Pick<RestoreTrackPayloadSnapshot, 'trackSnapshot'>[]
): void {
    const states = discardedPluginStatesByUndoEntryId.get(undoEntryId);
    if (states === undefined) {
        return;
    }
    for (const restore of restores) {
        const track = decodeTrackSnapshot(restore.trackSnapshot);
        if (track) {
            restore.trackSnapshot = {
                ...track,
                devices: track.devices.map((device) => withRecordedState(device, states)),
            };
        }
    }
}

export function forgetDiscardedPluginStates(undoEntryId: string): void {
    discardedPluginStatesByUndoEntryId.delete(undoEntryId);
}

function withRecordedSnapshotState(device: DeviceSnapshot, states: DiscardedPluginStates): DeviceSnapshot {
    if (!states.has(device.id)) {
        return device;
    }
    const { externalStateChunk: _snapshotChunk, ...withoutChunk } = device;
    const recordedChunk = states.get(device.id);
    if (recordedChunk === undefined) {
        return withoutChunk;
    }
    return { ...withoutChunk, externalStateChunk: recordedChunk };
}

/**
 * The device snapshots a removal's restore carries, with the recorded plugin states
 * overlaid. Like `overlayDiscardedPluginStates`, it leaves the record for a retry.
 */
export function overlayDiscardedDevicePluginStates(
    undoEntryId: string,
    devices: readonly DeviceSnapshot[]
): readonly DeviceSnapshot[] {
    const states = discardedPluginStatesByUndoEntryId.get(undoEntryId);
    if (states === undefined) {
        return devices;
    }
    return devices.map((device) => withRecordedSnapshotState(device, states));
}

/** A restore's afterCommit that first drops the record it overlaid, so only a committed restore consumes it. */
export function forgettingDiscardedPluginStates(undoEntryId: string | undefined, afterCommit: () => void): () => void {
    if (undoEntryId === undefined) {
        return afterCommit;
    }
    return () => {
        forgetDiscardedPluginStates(undoEntryId);
        afterCommit();
    };
}
