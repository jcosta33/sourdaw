export const MIN_RATIO = 0.25;
export const MAX_RATIO = 4.0;

export function clampRatio(ratio: number): number {
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}