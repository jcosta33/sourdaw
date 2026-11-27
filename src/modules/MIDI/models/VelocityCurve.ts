export const VELOCITY_CURVE_NAMES = ['linear', 'exponential', 'logarithmic', 's-curve', 'compress', 'expand'] as const;

export function isVelocityCurveName(value: string): boolean {
    return VELOCITY_CURVE_NAMES.some((name) => name === value);
}
