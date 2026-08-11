import { configureAutomationParameterRangeResolverPort } from '../services/automationParameterRangeResolver';

type AutomationParameterRangeResolver = (input: {
    trackId: string;
    parameterTargetId: string;
}) => { minValue: number; maxValue: number } | null;

export function setAutomationParameterRangeResolver(resolver: AutomationParameterRangeResolver | null): void {
    configureAutomationParameterRangeResolverPort(resolver);
}
