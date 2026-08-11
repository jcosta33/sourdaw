import {
    type AutomationParameterRangeResolver,
    automationParameterRangeResolver,
} from './automationParameterRangeDependencies';

export function getAutomationParameterRangeResolver(): AutomationParameterRangeResolver | null {
    return automationParameterRangeResolver;
}
