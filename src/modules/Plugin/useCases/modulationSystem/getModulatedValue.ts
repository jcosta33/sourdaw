import { modulationSources } from './types';
import { getModulationRoutesForParam } from './getModulationRoutesForParam';
import { createSeededRandom } from '#/helpers/SeededRandom/SeededRandom';

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
        const source = modulationSources.get(route.sourceId);
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
            case 'random': {
                // Deterministic "random" based on time — same time = same value
                const rng = createSeededRandom(Math.floor(time * 10));
                sourceValue = rng() * 2 - 1;
                break;
            }
            default:
                sourceValue = 0;
        }

        modulated += sourceValue * route.amount;
    }

    return Math.max(0, Math.min(1, modulated));
}
