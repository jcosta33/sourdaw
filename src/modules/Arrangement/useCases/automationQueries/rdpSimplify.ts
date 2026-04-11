import { rdpSimplify as simplifyAutomationPoints } from '../../transformers/automationTransformers';

export function rdpSimplify(
    ...args: Parameters<typeof simplifyAutomationPoints>
): ReturnType<typeof simplifyAutomationPoints> {
    return simplifyAutomationPoints(...args);
}