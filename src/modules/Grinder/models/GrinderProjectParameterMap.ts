import { DEFAULT_PATCH, type GrinderPatch } from './GrinderPatch';

/** Descriptor-backed Grinder controls stored in `Device.parameterValues`. */
export const GRINDER_PROJECT_PARAM_KEYS = [
    'inputGain',
    'inputImpedance',
    'gateThreshold',
    'gateAttack',
    'gateRelease',
    'gain',
    'channel',
    'bright',
    'fat',
    'bass',
    'mid',
    'treble',
    'presence',
    'resonance',
    'master',
    'sagAmount',
    'sagRecovery',
    'negFeedback',
    'transformerDrive',
    'transformerHysteresis',
    'transformerLfSaturation',
    'cabResonanceFreq',
    'cabResonanceQ',
    'cabDamping',
    'coneBreakup',
    'backEmf',
    'micBlend',
    'roomAmount',
    'tubeBias',
    'tubeAge',
    'millerCapacitance',
    'gridConduction',
    'couplingCapCharge',
    'powerAmpBias',
    'engineMode',
    'neuralMix',
    'neuralCpuBudget',
    'outputGain',
    'outputMix',
    'cleanBlend',
    'limiterThreshold',
] as const satisfies readonly (keyof GrinderPatch)[];

const ENGINE_MODES: readonly GrinderPatch['engineMode'][] = ['circuit', 'capture', 'hybrid'];

export function applyGrinderProjectParameters(
    patch: GrinderPatch,
    parameterValues: Readonly<Record<string, unknown>>
): GrinderPatch {
    const next = { ...patch };

    for (const key of GRINDER_PROJECT_PARAM_KEYS) {
        const raw = parameterValues[key];
        let value: GrinderPatch[typeof key] = DEFAULT_PATCH[key];

        if (typeof raw === 'number' && Number.isFinite(raw)) {
            if (key === 'bright' || key === 'fat') {
                value = raw > 0.5;
            } else if (key === 'engineMode') {
                const index = Math.max(0, Math.min(ENGINE_MODES.length - 1, Math.round(raw)));
                value = ENGINE_MODES[index] ?? DEFAULT_PATCH.engineMode;
            } else {
                value = raw;
            }
        }

        Object.assign(next, { [key]: value });
    }

    return next;
}
