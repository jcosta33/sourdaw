type AutomationParameterRange = { minValue: number; maxValue: number };
type AutomationParameterRangeInput = { trackId: string; parameterTargetId: string };
type AutomationParameterRangeResolver = (input: AutomationParameterRangeInput) => AutomationParameterRange | null;

let parameterRangeResolver: AutomationParameterRangeResolver | null = null;

export function configureAutomationParameterRangeResolverPort(resolver: AutomationParameterRangeResolver | null): void {
    parameterRangeResolver = resolver;
}

export function resolveAutomationParameterRange(input: AutomationParameterRangeInput): AutomationParameterRange | null {
    return parameterRangeResolver?.(input) ?? null;
}
