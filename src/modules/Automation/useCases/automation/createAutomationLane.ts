import { createAutomationLane as _createAutomationLane } from '../../models/Automation';

import type { AutomationLane } from '../../models/Automation';

/**
 * Creates a new, empty automation lane.
 */
export function createAutomationLane(
    trackId: string,
    parameterId: string,
    parameterName: string,
    minValue = 0,
    maxValue = 1,
    clipId?: string
): AutomationLane {
    return _createAutomationLane(trackId, parameterId, parameterName, minValue, maxValue, clipId);
}
