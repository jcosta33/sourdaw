import { setActiveYeastDevice, yeastDeviceIdsInProjectOrder, yeastStore, type YeastState } from '../stores/yeastStore';

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
 * instance (issue #2422), so hydration writes EVERY Yeast device's rack: each
 * write is authored while its device is pinned, the pin switch flushes the
 * previous device's write under that device's id, and a device the file
 * carries no rack for hydrates to an empty rack. The legacy flat form
 * attaches its one rack to the first Yeast device in project order — the
 * same owner the CRDT slot's v1→v2 parking picks. Ends unpinned: project
 * load has no panel open, so the active rack resolves from selection.
 */
export function hydrateYeastState(state: HydrateYeastStateInput): void {
    const uiLevel = yeastStore.value?.uiLevel ?? 1;
    const processorsById = new Map<string, YeastProcessorSnapshot>();
    if (state !== undefined && 'racks' in state) {
        for (const [deviceId, rack] of Object.entries(state.racks)) {
            processorsById.set(deviceId, rack.processors);
        }
    } else if (state !== undefined) {
        const firstDeviceId = yeastDeviceIdsInProjectOrder()[0];
        if (firstDeviceId !== undefined) {
            processorsById.set(firstDeviceId, state.processors);
        }
    }

    for (const deviceId of yeastDeviceIdsInProjectOrder()) {
        setActiveYeastDevice(deviceId);
        yeastStore.set({
            processors: structuredClone(processorsById.get(deviceId) ?? []),
            uiLevel,
        });
    }
    setActiveYeastDevice(null);
    reconcileYeastGrooveAssignments();
}
