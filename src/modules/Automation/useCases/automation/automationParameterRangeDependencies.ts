export type AutomationParameterRangeResolver = (input: {
    trackId: string;
    parameterTargetId: string;
}) => { minValue: number; maxValue: number } | null;

export let automationParameterRangeResolver: AutomationParameterRangeResolver | null = null;

export function setAutomationParameterRangeResolver(resolver: AutomationParameterRangeResolver | null): void {
    automationParameterRangeResolver = resolver;
}
