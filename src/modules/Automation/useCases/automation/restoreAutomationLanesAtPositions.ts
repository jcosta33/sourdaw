import { type AutomationLane } from '../../models/Automation';
import { automationStore, is_exact_automation_lane } from '../../stores/automationStore';

export type PositionedAutomationLane = { readonly index: number; readonly lane: unknown };

/**
 * Put retired lanes back at the store positions they held when captured, so an
 * undo restores lane order as well as lane content. Entries are inserted in
 * ascending `index` order, each clamped to the list length, which reproduces
 * the captured order exactly when the store otherwise still holds what it held
 * after the lanes were removed.
 *
 * All or nothing: an empty list is a no-op that succeeds; otherwise returns
 * `false` and writes nothing when the store is absent,
 * any entry is not an exact lane snapshot or carries a non-integer index, two
 * entries share an id, or a lane id is already live.
 */
export function restoreAutomationLanesAtPositions(entries: readonly PositionedAutomationLane[]): boolean {
    if (entries.length === 0) {
        return true;
    }
    const state = automationStore.value;
    if (!state) {
        return false;
    }

    const liveIds = new Set(state.lanes.map((lane) => lane.id));
    const restored: { index: number; lane: AutomationLane }[] = [];
    for (const entry of entries) {
        if (!Number.isInteger(entry.index) || entry.index < 0 || !is_exact_automation_lane(entry.lane)) {
            return false;
        }
        if (liveIds.has(entry.lane.id)) {
            return false;
        }
        liveIds.add(entry.lane.id);
        restored.push({ index: entry.index, lane: entry.lane });
    }

    const lanes = [...state.lanes];
    for (const { index, lane } of restored.toSorted((left, right) => left.index - right.index)) {
        lanes.splice(Math.min(index, lanes.length), 0, lane);
    }
    automationStore.set({ lanes });
    return true;
}
