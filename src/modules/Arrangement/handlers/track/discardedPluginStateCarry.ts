import { type RestoreTrackPayloadSnapshot } from '#/utils/handlerContract';

import { type Device } from '../../models/Track';
import { decodeTrackSnapshot, type Track } from '../../stores/trackStore';

type DiscardedPluginStates = ReadonlyMap<string, string | undefined>;

// Held in memory only, so a reload between Undo and Redo restores the snapshot's chunk.
const discardedPluginStatesByUndoEntryId = new Map<string, DiscardedPluginStates>();

/**
 * Records each hosted device's plugin state as the discard of a created track saw it.
 * The redo snapshot was captured when the track was created, and a later save's
 * non-undoable capture moved the chunk past it; the discard guard does not compare the
 * chunk, so redo must not roll it back either.
 */
export function recordDiscardedPluginStates(undoEntryId: string, tracks: readonly Track[]): void {
    const states = new Map<string, string | undefined>();
    for (const device of tracks.flatMap((track) => track.devices)) {
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

/** Overlays the recorded plugin states onto a redo's restore snapshots, consuming the record. */
export function applyDiscardedPluginStates(
    undoEntryId: string,
    restores: readonly Pick<RestoreTrackPayloadSnapshot, 'trackSnapshot'>[]
): void {
    const states = discardedPluginStatesByUndoEntryId.get(undoEntryId);
    if (states === undefined) {
        return;
    }
    discardedPluginStatesByUndoEntryId.delete(undoEntryId);
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
