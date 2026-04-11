import { interpolateAutomationValue as interpolateAutomationValueFromTransformers } from '../../transformers/automationTransformers';

/**
 * Public contract for automation transformer utilities.
 */
export function interpolateAutomationValue(
    ...args: Parameters<typeof interpolateAutomationValueFromTransformers>
): ReturnType<typeof interpolateAutomationValueFromTransformers> {
    return interpolateAutomationValueFromTransformers(...args);
}