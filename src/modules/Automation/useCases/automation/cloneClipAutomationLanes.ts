import { buildDuplicatedLane } from '../../services/buildDuplicatedLane';
import { type AutomationLane } from '../../stores/automationStore';
import { automationStore } from '../../stores/automationStore';

/**
 * Clone pre-captured clip-scoped lanes onto a new clip id — the snapshot-fed
 * mirror of `duplicateClipAutomation`: the clipboard captured the source's
 * lanes at copy time, and the source clip (and with it its live lanes) may be
 * gone by the time a paste lands, so the copies are built from the capture
 * instead of the store. Each clone gets a fresh lane id and fresh point
 * objects (`buildDuplicatedLane`), so two pastes from one entry never alias.
 *
 * `pasteClip`'s undo drops the clones with the pasted clip: the restore's
 * clip-automation-lane transition removes every captured lane the pre-paste
 * capture does not carry, keyed by the fresh lane ids minted here.
 */
export function cloneClipAutomationLanes(sourceLanes: readonly AutomationLane[], targetClipId: string): void {
    if (sourceLanes.length === 0) {
        return;
    }

    const state = automationStore.value;
    if (!state) {
        return;
    }

    const newLanes = sourceLanes.map((lane) => buildDuplicatedLane(lane, lane.trackId, targetClipId));

    automationStore.set({
        lanes: [...state.lanes, ...newLanes],
    });
}
