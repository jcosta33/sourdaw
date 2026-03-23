import { modulationSources } from './types';
import { getModulationRoutesForParam } from './getModulationRoutesForParam';

/**
 * Get the total modulation range for a parameter (for halo rendering).
 * Returns [min, max] as offsets from the base parameter value.
 */
export function getModulationRange(deviceId: string, parameterName: string): [number, number] {
    const paramRoutes = getModulationRoutesForParam(deviceId, parameterName);
    if (paramRoutes.length === 0) {
        return [0, 0];
    }

    let positiveSum = 0;
    let negativeSum = 0;
    for (const route of paramRoutes) {
        const source = modulationSources.get(route.sourceId);
        if (!source) {
            continue;
        }
        const depth = Math.abs(route.amount);
        if (route.bipolar) {
            positiveSum += depth;
            negativeSum -= depth;
        } else if (route.amount >= 0) {
            positiveSum += depth;
        } else {
            negativeSum -= depth;
        }
    }

    return [negativeSum, positiveSum];
}
