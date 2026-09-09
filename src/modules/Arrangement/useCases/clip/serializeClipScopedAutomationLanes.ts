import { readClipScopedAutomationLanes } from './readClipScopedAutomationLanes';
import { serializeProjectedClipScopedAutomationLanes } from './serializeProjectedClipScopedAutomationLanes';

/**
 * Canonical JSON of the clip-scoped automation lanes keyed to the given clip
 * ids, in lane-id order. Both the capture side (a duplicate handler freezing
 * the lanes its generation cloned onto the copy) and the guard side
 * (`isGeneratedMidiStateCurrent`) serialize through this one function, so the
 * comparison can never drift on lane order or store iteration order.
 */
export function serializeClipScopedAutomationLanes(clipIds: readonly string[]): string {
    return serializeProjectedClipScopedAutomationLanes(readClipScopedAutomationLanes(clipIds));
}
