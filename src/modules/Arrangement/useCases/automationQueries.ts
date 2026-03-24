/**
 * Public contract re-exports for automation transformer utilities.
 * Cross-module consumers should import from here instead of private transformers/.
 */
export {
    interpolateAutomationValue,
    rdpSimplify,
    getAutomationRegions,
    type AutomationShapeType,
    generateShapePoints,
} from '../transformers/automationTransformers';

export {
    applyVelocityCurve,
    type VelocityCurve,
} from '../transformers/velocityCurveTransformer';
