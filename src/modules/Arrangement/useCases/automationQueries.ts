import {
    interpolateAutomationValue as interpolateAutomationValueFromTransformers,
    rdpSimplify as simplifyAutomationPoints,
    getAutomationRegions as getAutomationRegionsFromTransformers,
    generateShapePoints as generateAutomationShapePoints,
    type AutomationShapeType as NativeAutomationShapeType,
} from '../transformers/automationTransformers';
import {
    applyVelocityCurve as applyVelocityCurveFromTransformer,
    type VelocityCurve as NativeVelocityCurve,
} from '../transformers/velocityCurveTransformer';

export type AutomationShapeType = NativeAutomationShapeType;
export type VelocityCurve = NativeVelocityCurve;

/**
 * Public contract for automation transformer utilities.
 */
export function interpolateAutomationValue(
    ...args: Parameters<typeof interpolateAutomationValueFromTransformers>
): ReturnType<typeof interpolateAutomationValueFromTransformers> {
    return interpolateAutomationValueFromTransformers(...args);
}

export function rdpSimplify(
    ...args: Parameters<typeof simplifyAutomationPoints>
): ReturnType<typeof simplifyAutomationPoints> {
    return simplifyAutomationPoints(...args);
}

export function getAutomationRegions(
    ...args: Parameters<typeof getAutomationRegionsFromTransformers>
): ReturnType<typeof getAutomationRegionsFromTransformers> {
    return getAutomationRegionsFromTransformers(...args);
}

export function generateShapePoints(
    ...args: Parameters<typeof generateAutomationShapePoints>
): ReturnType<typeof generateAutomationShapePoints> {
    return generateAutomationShapePoints(...args);
}

export function applyVelocityCurve(
    ...args: Parameters<typeof applyVelocityCurveFromTransformer>
): ReturnType<typeof applyVelocityCurveFromTransformer> {
    return applyVelocityCurveFromTransformer(...args);
}
