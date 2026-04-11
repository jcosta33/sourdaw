import { applyVelocityCurve as applyVelocityCurveFromTransformer } from '../../transformers/velocityCurveTransformer';

export function applyVelocityCurve(
    ...args: Parameters<typeof applyVelocityCurveFromTransformer>
): ReturnType<typeof applyVelocityCurveFromTransformer> {
    return applyVelocityCurveFromTransformer(...args);
}