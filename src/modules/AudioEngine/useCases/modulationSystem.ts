/**
 * Modulation System.
 * Defines modulation sources, targets, and routing connections.
 * Supports: LFO, Envelope, MIDI CC, Macro knobs.
 *
 * This provides the data model and routing; rendering of halos/indicators
 * is done in the UI layer.
 *
 * TODO: NEEDS AudioParam WIRING — no audio effect currently.
 *   The in-memory `sources` and `routes` Maps are populated correctly, but
 *   nothing reads them at audio rate. getModulatedValue() is correct math
 *   but is never called in a render loop or AudioWorklet processor.
 *   To implement:
 *     1. Add a ModulationWorklet that runs at audio rate (128-sample blocks)
 *     2. Map ModulationRoute.target → deviceId/parameterName → AudioParam ref
 *     3. Drive AudioParam.value via the worklet output or setValueAtTime()
 *   Until then, LFO / Envelope / Random / Macro presets have no audible effect.
 */

export type ModulationSourceType = 'lfo' | 'envelope' | 'midi-cc' | 'macro' | 'random' | 'step-seq';

export type ModulationSource = {
    id: string;
    type: ModulationSourceType;
    name: string;
    /** LFO rate in Hz, envelope times, CC number, etc. */
    parameters: Record<string, number>;
};

export type ModulationTarget = {
    deviceId: string;
    parameterName: string;
};

export type ModulationRoute = {
    id: string;
    sourceId: string;
    target: ModulationTarget;
    amount: number; // -1 to +1
    bipolar: boolean;
};

// In-memory stores
const sources = new Map<string, ModulationSource>();
const routes = new Map<string, ModulationRoute>();

// ─── Source Management ────────────────────────────────────

export function createModulationSource(type: ModulationSourceType, name?: string): ModulationSource {
    const defaultParams: Record<string, number> =
        {
            lfo: { rate: 1, depth: 1, phase: 0, waveform: 0 },
            envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.5 },
            'midi-cc': { cc: 1, channel: 0 },
            macro: { value: 0.5 },
            random: { rate: 4, smoothing: 0.5 },
            'step-seq': { steps: 8, rate: 1 },
        }[type] ?? {};

    const source: ModulationSource = {
        id: `mod-src-${crypto.randomUUID().slice(0, 8)}`,
        type,
        name: name ?? `${type.toUpperCase()} ${sources.size + 1}`,
        parameters: { ...defaultParams },
    };
    sources.set(source.id, source);
    return source;
}

export function updateModulationSourceParam(sourceId: string, param: string, value: number): void {
    const source = sources.get(sourceId);
    if (source) {
        source.parameters[param] = value;
    }
}

export function deleteModulationSource(sourceId: string): void {
    sources.delete(sourceId);
    // Remove routes using this source
    for (const [routeId, route] of routes) {
        if (route.sourceId === sourceId) {
            routes.delete(routeId);
        }
    }
}

export function getAllModulationSources(): ModulationSource[] {
    return [...sources.values()];
}

// ─── Route Management ─────────────────────────────────────

export function createModulationRoute(
    sourceId: string,
    target: ModulationTarget,
    amount = 0.5,
    bipolar = false
): ModulationRoute | null {
    if (!sources.has(sourceId)) {
        return null;
    }

    const route: ModulationRoute = {
        id: `mod-route-${crypto.randomUUID().slice(0, 8)}`,
        sourceId,
        target,
        amount: Math.max(-1, Math.min(1, amount)),
        bipolar,
    };
    routes.set(route.id, route);
    return route;
}

export function setModulationAmount(routeId: string, amount: number): void {
    const route = routes.get(routeId);
    if (route) {
        route.amount = Math.max(-1, Math.min(1, amount));
    }
}

export function deleteModulationRoute(routeId: string): void {
    routes.delete(routeId);
}

export function getAllModulationRoutes(): ModulationRoute[] {
    return [...routes.values()];
}

/**
 * Get all routes targeting a specific device parameter.
 * Used by the UI to render modulation halos on knobs.
 */
export function getModulationRoutesForParam(deviceId: string, parameterName: string): ModulationRoute[] {
    const result: ModulationRoute[] = [];
    for (const route of routes.values()) {
        if (route.target.deviceId === deviceId && route.target.parameterName === parameterName) {
            result.push(route);
        }
    }
    return result;
}

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
        const source = sources.get(route.sourceId);
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

/**
 * Compute the current modulated value for a parameter.
 * In a real implementation this would run at audio rate;
 * here it provides a UI-rate approximation.
 *
 * @param baseValue - The knob's base value (0-1)
 * @param deviceId - Target device
 * @param parameterName - Target parameter
 * @param time - Current time in seconds for LFO phase
 */
export function getModulatedValue(baseValue: number, deviceId: string, parameterName: string, time: number): number {
    const paramRoutes = getModulationRoutesForParam(deviceId, parameterName);
    let modulated = baseValue;

    for (const route of paramRoutes) {
        const source = sources.get(route.sourceId);
        if (!source) {
            continue;
        }

        let sourceValue = 0;
        switch (source.type) {
            case 'lfo': {
                const rate = source.parameters.rate ?? 1;
                const phase = source.parameters.phase ?? 0;
                const waveform = source.parameters.waveform ?? 0;
                const t = time * rate + phase;
                if (waveform === 0) {
                    sourceValue = Math.sin(t * Math.PI * 2); // Sine
                } else if (waveform === 1) {
                    sourceValue = ((t % 1) - 0.5) * 2; // Saw
                } else if (waveform === 2) {
                    sourceValue = t % 1 < 0.5 ? 1 : -1; // Square
                } else {
                    sourceValue = 1 - Math.abs((t % 1) * 2 - 1) * 2; // Triangle
                }
                break;
            }
            case 'macro':
                sourceValue = (source.parameters.value ?? 0.5) * 2 - 1; // -1 to +1
                break;
            case 'random':
                sourceValue = Math.random() * 2 - 1;
                break;
            default:
                sourceValue = 0;
        }

        modulated += sourceValue * route.amount;
    }

    return Math.max(0, Math.min(1, modulated));
}
