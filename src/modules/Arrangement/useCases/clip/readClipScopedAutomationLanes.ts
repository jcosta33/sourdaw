import { getAutomationLanes } from '#/modules/Automation/useCases';

export type AutomationLaneValue = ReturnType<typeof getAutomationLanes>[number];

/**
 * Full lane objects for every clip-scoped automation lane keyed to one of the
 * given clip ids. Track-level lanes (`clipId === undefined`) are never
 * included — this is only ever called with clip ids a clip-identity change is
 * about to retire or re-key.
 */
export function readClipScopedAutomationLanes(clipIds: readonly string[]): AutomationLaneValue[] {
    const idSet = new Set(clipIds);
    return getAutomationLanes().filter((lane) => lane.clipId !== undefined && idSet.has(lane.clipId));
}
