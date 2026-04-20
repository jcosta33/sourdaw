import { getAutomationRegions as getAutomationRegionsFromTransformers } from '../../transformers/automationTransformers';

export function getAutomationRegions(
    ...args: Parameters<typeof getAutomationRegionsFromTransformers>
): ReturnType<typeof getAutomationRegionsFromTransformers> {
    return getAutomationRegionsFromTransformers(...args);
}
