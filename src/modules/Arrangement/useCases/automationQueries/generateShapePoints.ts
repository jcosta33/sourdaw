import { generateShapePoints as generateAutomationShapePoints } from '../../transformers/automationTransformers';

export function generateShapePoints(
    ...args: Parameters<typeof generateAutomationShapePoints>
): ReturnType<typeof generateAutomationShapePoints> {
    return generateAutomationShapePoints(...args);
}
