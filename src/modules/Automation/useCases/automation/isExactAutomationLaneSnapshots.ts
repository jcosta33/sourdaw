import { type AutomationLane } from '../../models/Automation';
import { is_exact_automation_lane } from '../../stores/automationStore';

/** Accept only the complete lane snapshots that Automation can restore verbatim. */
export function isExactAutomationLaneSnapshots(value: unknown): value is readonly AutomationLane[] {
    if (!Array.isArray(value)) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index) || !is_exact_automation_lane(value[index])) {
            return false;
        }
    }
    return true;
}
