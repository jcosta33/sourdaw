import { modulationRoutes, type ModulationRoute } from './types';

/**
 * Get all routes targeting a specific device parameter.
 * Used by the UI to render modulation halos on knobs.
 */
export function getModulationRoutesForParam(deviceId: string, parameterName: string): ModulationRoute[] {
    const result: ModulationRoute[] = [];
    for (const route of modulationRoutes.values()) {
        if (route.target.deviceId === deviceId && route.target.parameterName === parameterName) {
            result.push(route);
        }
    }
    return result;
}
