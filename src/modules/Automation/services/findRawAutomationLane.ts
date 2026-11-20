import { isRecord } from '#/utils/structuralEquality';

export function findRawAutomationLane(
    document: Readonly<Record<string, unknown>>,
    laneId: string
): Record<string, unknown> | undefined {
    const automation = document.automation;
    if (!isRecord(automation) || !Array.isArray(automation.lanes)) {
        return undefined;
    }
    let match: Record<string, unknown> | undefined;
    const lanes: unknown[] = automation.lanes;
    for (const lane of lanes) {
        if (isRecord(lane) && lane.id === laneId) {
            if (match) {
                return undefined;
            }
            match = lane;
        }
    }
    return match;
}
