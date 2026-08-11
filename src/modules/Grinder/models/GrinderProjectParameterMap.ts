import { DEFAULT_PATCH, type GrinderPatch } from './GrinderPatch';

/** Direct Grinder patch controls serialized into `Device.parameterValues`. */
export const GRINDER_PROJECT_PARAM_KEYS = [
    'engineMode',
    'inputImpedance',
    'inputGain',
    'gateEnabled',
    'gateThreshold',
    'gateAttack',
    'gateRelease',
    'ampModel',
    'gain',
    'channel',
    'bright',
    'fat',
    'tubeBias',
    'tubeAge',
    'millerCapacitance',
    'gridConduction',
    'couplingCapCharge',
    'toneStackType',
    'bass',
    'mid',
    'treble',
    'presence',
    'resonance',
    'brightCap',
    'master',
    'powerTubeType',
    'rectifierType',
    'sagAmount',
    'sagRecovery',
    'negFeedback',
    'powerAmpBias',
    'transformerDrive',
    'transformerHysteresis',
    'transformerLfSaturation',
    'cabType',
    'cabEnabled',
    'cabResonanceFreq',
    'cabResonanceQ',
    'cabDamping',
    'cabOpenBack',
    'coneBreakup',
    'backEmf',
    'neuralEnabled',
    'neuralPlacement',
    'neuralTier',
    'neuralMix',
    'neuralCpuBudget',
    'outputGain',
    'outputMix',
    'limiterEnabled',
    'limiterThreshold',
    'cleanBlend',
    'routingMode',
    'micBlend',
    'roomAmount',
] as const satisfies readonly (keyof GrinderPatch)[];

const ENGINE_MODES: readonly GrinderPatch['engineMode'][] = ['circuit', 'capture', 'hybrid'];
const AMP_MODELS: readonly GrinderPatch['ampModel'][] = [
    'clean-twin',
    'crunch-jcm',
    'lead-jcm',
    'ac30-tb',
    'rectifier',
    'custom',
];
const TONE_STACK_TYPES: readonly GrinderPatch['toneStackType'][] = ['fender', 'marshall', 'vox'];
const POWER_TUBE_TYPES: readonly GrinderPatch['powerTubeType'][] = ['6l6', 'el34', 'el84'];
const RECTIFIER_TYPES: readonly GrinderPatch['rectifierType'][] = ['tube', 'solid-state', 'variac'];
const CAB_TYPES: readonly GrinderPatch['cabType'][] = ['ir', 'parametric', 'both'];
const NEURAL_PLACEMENTS: readonly GrinderPatch['neuralPlacement'][] = ['amp-capture', 'rig-capture'];
const NEURAL_TIERS: readonly GrinderPatch['neuralTier'][] = ['standard', 'lite', 'nano', 'recurrent'];
const ROUTING_MODES: readonly GrinderPatch['routingMode'][] = ['serial', 'parallel', 'wet-dry-wet', 'dual-amp'];
type GrinderProjectParamKey = (typeof GRINDER_PROJECT_PARAM_KEYS)[number];
const INDEXED_VALUES: Partial<Record<GrinderProjectParamKey, readonly string[]>> = {
    engineMode: ENGINE_MODES,
    ampModel: AMP_MODELS,
    toneStackType: TONE_STACK_TYPES,
    powerTubeType: POWER_TUBE_TYPES,
    rectifierType: RECTIFIER_TYPES,
    cabType: CAB_TYPES,
    neuralPlacement: NEURAL_PLACEMENTS,
    neuralTier: NEURAL_TIERS,
    routingMode: ROUTING_MODES,
};
const BOOLEAN_KEYS: ReadonlySet<keyof GrinderPatch> = new Set([
    'gateEnabled',
    'bright',
    'fat',
    'brightCap',
    'cabEnabled',
    'cabOpenBack',
    'neuralEnabled',
    'limiterEnabled',
]);

function indexedValue(options: readonly string[], raw: number): string {
    const index = Math.max(0, Math.min(options.length - 1, Math.round(raw)));
    return options[index] ?? options[0] ?? '';
}

function decodeProjectValue(key: GrinderProjectParamKey, raw: number): unknown {
    if (BOOLEAN_KEYS.has(key)) {
        return raw > 0.5;
    }
    const options = INDEXED_VALUES[key];
    if (options) {
        return indexedValue(options, raw);
    }
    return raw;
}

export function applyGrinderProjectParameters(
    patch: GrinderPatch,
    parameterValues: Readonly<Record<string, unknown>>
): GrinderPatch {
    const next = { ...patch };

    for (const key of GRINDER_PROJECT_PARAM_KEYS) {
        const raw = parameterValues[key];
        let value: unknown = DEFAULT_PATCH[key];

        if (typeof raw === 'number' && Number.isFinite(raw)) {
            value = decodeProjectValue(key, raw);
        }

        Object.assign(next, { [key]: value });
    }

    return next;
}
