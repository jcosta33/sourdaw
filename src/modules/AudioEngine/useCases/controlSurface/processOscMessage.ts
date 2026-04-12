import { controlSurfaceStore } from '../../stores/controlSurface';

/**
 * Process an incoming OSC message and return the mapped action + value.
 */
export function processOscMessage(
    address: string,
    value: number
): { actionType: string; parameterPath: string; normalizedValue: number } | null {
    const state = controlSurfaceStore.value;
    if (!state) {
        return null;
    }

    const mapping = state.oscMappings.find((m) => m.oscAddress === address);
    if (!mapping) {
        return null;
    }

    const range = mapping.max - mapping.min;
    const normalizedValue = range > 0 ? (value - mapping.min) / range : 0;

    return {
        actionType: mapping.actionType,
        parameterPath: mapping.parameterPath,
        normalizedValue: Math.max(0, Math.min(1, normalizedValue)),
    };
}
