import {
    LEGACY_SHARED_RACK_DEVICE_ID,
    setActiveYeastDevice,
    yeastDeviceIdsInProjectOrder,
    yeastStore,
    type YeastState,
} from '../stores/yeastStore';

import { reconcileYeastGrooveAssignments } from './reconcileYeastGrooveAssignments';

type YeastProcessorSnapshot = YeastState['processors'];
type HydrateYeastStateInput =
    /** Device-keyed racks — the project file's current shape. */
    | { racks: Record<string, { processors: YeastProcessorSnapshot }> }
    /** Pre-split single-rack file: attaches to the first Yeast device in project order. */
    | { processors: YeastProcessorSnapshot }
    | undefined;

/**
 * Restore rack state from the flat project file. Rack state is per device
 * instance (issue #2422), so hydration writes a rack for every device the
 * project knows: each write is authored while its device is pinned, and the
 * pin switch flushes the previous device's write under that device's id.
 * That is EVERY rack the file carries — including devices that live only in
 * stored arrangements, which the write side unions in (`buildProjectData`)
 * and which no other load path re-hydrates (`switchArrangement` does not touch
 * rack state) — plus an empty rack for a live device the file carries no rack
 * for. The legacy flat form attaches its one rack to the first Yeast device
 * in project order — the same owner the CRDT slot's v1→v2 parking picks.
 * Ends unpinned: project load has no panel open, so the active rack resolves
 * from selection.
 */
export function hydrateYeastState(state: HydrateYeastStateInput): void {
    const uiLevel = yeastStore.value?.uiLevel ?? 1;
    const processorsById = new Map<string, YeastProcessorSnapshot>();
    if (state !== undefined && 'racks' in state) {
        for (const [deviceId, rack] of Object.entries(state.racks)) {
            processorsById.set(deviceId, rack.processors);
        }
    } else if (state !== undefined) {
        // The legacy flat form attaches to the first LIVE Yeast device in
        // project order — the same owner the CRDT slot's v1→v2 parking
        // adopts. With no live Yeast device (its holder lives only in a
        // stored arrangement, or the file predates Yeast devices entirely)
        // the rack parks under the CRDT slot's reserved legacy key instead
        // of being dropped: it survives in the document and the first Yeast
        // device to write adopts it, exactly as the CRDT path behaves.
        const firstDeviceId = yeastDeviceIdsInProjectOrder()[0];
        processorsById.set(firstDeviceId ?? LEGACY_SHARED_RACK_DEVICE_ID, state.processors);
    }

    // Live devices first (project order), then any file-carried device the
    // live enumeration does not know — a device that exists only in a stored
    // arrangement. Without the second set, that device's rack is never
    // written and the next save persists the loss.
    const deviceIds = [...yeastDeviceIdsInProjectOrder()];
    for (const deviceId of processorsById.keys()) {
        if (!deviceIds.includes(deviceId)) {
            deviceIds.push(deviceId);
        }
    }
    for (const deviceId of deviceIds) {
        setActiveYeastDevice(deviceId);
        yeastStore.set({
            processors: structuredClone(processorsById.get(deviceId) ?? []),
            uiLevel,
        });
    }
    setActiveYeastDevice(null);
    reconcileYeastGrooveAssignments();
}
