import { type ClipScopedAutomationLane } from './readClipScopedAutomationLanes';

/**
 * Canonical JSON of given clip-scoped automation lanes, in lane-id order. Both
 * the capture side (a duplicate handler freezing the lanes its generation
 * cloned onto the copy, via `serializeClipScopedAutomationLanes`) and the
 * batch-aware guard side serialize through this one function, so the
 * comparison can never drift on lane order or lane shape (#3814). Callers pass
 * only lanes already scoped to the clip ids being serialized.
 */
export function serializeProjectedClipScopedAutomationLanes(lanes: readonly ClipScopedAutomationLane[]): string {
    const snapshots = lanes.map((lane) => ({ ...lane }));
    snapshots.sort((left, right) => left.id.localeCompare(right.id));
    return JSON.stringify(snapshots);
}
