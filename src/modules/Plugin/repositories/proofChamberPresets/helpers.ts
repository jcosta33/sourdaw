import {
    type ProofChamberEngineState,
    DEFAULT_PARAMS,
    expandSpacePreset,
    type SpaceType,
    type ProofChamberAlgorithm,
} from '../../models/ProofChamberState';

export type ProofChamberPreset = {
    id: string;
    name: string;
    category: 'hall' | 'room' | 'plate' | 'spring' | 'creative' | 'user';
    params: ProofChamberEngineState;
};

// ---------------------------------------------------------------------------
// Factory presets
// ---------------------------------------------------------------------------

export const FACTORY_PRESETS: ProofChamberPreset[] = [
    // Halls
    {
        id: 'hall-large',
        name: 'Large Concert Hall',
        category: 'hall',
        params: { ...expandSpacePreset('hall'), algorithm: 'fdn-8' as ProofChamberAlgorithm },
    },
    {
        id: 'hall-cathedral',
        name: 'Cathedral',
        category: 'hall',
        params: expandSpacePreset('cathedral'),
    },
    {
        id: 'hall-vintage',
        name: 'Vintage Hall (80s)',
        category: 'hall',
        params: { ...expandSpacePreset('hall'), vintage: 1 },
    },

    // Rooms
    {
        id: 'room-small',
        name: 'Small Room',
        category: 'room',
        params: { ...expandSpacePreset('room'), algorithm: 'fdn-8' as ProofChamberAlgorithm },
    },
    {
        id: 'room-vocal',
        name: 'Vocal Room',
        category: 'room',
        params: { ...expandSpacePreset('room'), mix: 0.2, decay: 0.3, highCut: 8000 },
    },
    {
        id: 'room-ambient',
        name: 'Ambient Room',
        category: 'room',
        params: { ...expandSpacePreset('room'), mix: 0.4, decay: 0.5, modDepth: 0.5 },
    },

    // Plates
    {
        id: 'plate-classic',
        name: 'Classic Plate',
        category: 'plate',
        params: expandSpacePreset('plate'),
    },
    {
        id: 'plate-bright',
        name: 'Bright Plate',
        category: 'plate',
        params: { ...expandSpacePreset('plate'), highCut: 18000, damping: 0.05 },
    },
    {
        id: 'plate-dark',
        name: 'Dark Plate',
        category: 'plate',
        params: { ...expandSpacePreset('plate'), highCut: 4000, damping: 0.6, vintage: 2 },
    },

    // Spring
    {
        id: 'spring-guitar',
        name: 'Guitar Spring',
        category: 'spring',
        params: expandSpacePreset('spring'),
    },
    {
        id: 'spring-dark',
        name: 'Dark Spring',
        category: 'spring',
        params: { ...expandSpacePreset('spring'), damping: 0.6, highCut: 5000, vintage: 2 },
    },

    // Creative
    {
        id: 'shimmer-pad',
        name: 'Shimmer Pad',
        category: 'creative',
        params: { ...expandSpacePreset('shimmer'), shimmer: true, shimmerAmount: 0.35 },
    },
    {
        id: 'infinite-hold',
        name: 'Infinite Hold',
        category: 'creative',
        params: expandSpacePreset('infinite'),
    },
    {
        id: 'ghost-reverb',
        name: 'Ghost Reverb',
        category: 'creative',
        params: {
            ...DEFAULT_PARAMS,
            space: 'hall' as SpaceType,
            decay: 0.9,
            damping: 0.7,
            modDepth: 0.8,
            mix: 0.5,
            shimmer: true,
            shimmerAmount: 0.15,
            vintage: 2,
        },
    },
    {
        id: 'massive-wash',
        name: 'Massive Wash',
        category: 'creative',
        params: {
            ...DEFAULT_PARAMS,
            space: 'cathedral' as SpaceType,
            algorithm: 'fdn-16' as ProofChamberAlgorithm,
            decay: 0.95,
            mix: 0.6,
            modDepth: 0.5,
            shimmer: true,
            shimmerAmount: 0.2,
        },
    },
];

// ---------------------------------------------------------------------------
// User presets (localStorage)
// ---------------------------------------------------------------------------

export const USER_PRESETS_KEY = 'proof-chamber-user-presets';

const preset_categories: readonly string[] = ['hall', 'room', 'plate', 'spring', 'creative', 'user'];
const proof_chamber_algorithms: readonly string[] = ['plate', 'fdn-8', 'fdn-16', 'spring'];
const space_types: readonly string[] = [
    'hall',
    'room',
    'plate',
    'chamber',
    'cathedral',
    'shimmer',
    'infinite',
    'spring',
];
const numeric_param_keys = [
    'mix',
    'decay',
    'damping',
    'predelay',
    'size',
    'modRate',
    'modDepth',
    'diffusion',
    'highCut',
    'lowCut',
    'width',
    'shimmerAmount',
    'shimmerPitch',
    'gravity',
    'earlyLateBalance',
    'vintage',
] as const;
const boolean_param_keys = ['freeze', 'shimmer', 'saturation'] as const;

type UnknownRecord = {
    readonly [key: string]: unknown;
};

function is_unknown_record(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function is_supported_preset_category(value: unknown): value is ProofChamberPreset['category'] {
    return typeof value === 'string' && preset_categories.includes(value);
}

function is_supported_algorithm(value: unknown): value is ProofChamberAlgorithm {
    return typeof value === 'string' && proof_chamber_algorithms.includes(value);
}

function is_supported_space(value: unknown): value is SpaceType {
    return typeof value === 'string' && space_types.includes(value);
}

function has_finite_numeric_params(value: UnknownRecord): boolean {
    return numeric_param_keys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]));
}

function has_boolean_params(value: UnknownRecord): boolean {
    return boolean_param_keys.every((key) => typeof value[key] === 'boolean');
}

function is_proof_chamber_engine_state(value: unknown): value is ProofChamberEngineState {
    return (
        is_unknown_record(value) &&
        is_supported_algorithm(value.algorithm) &&
        is_supported_space(value.space) &&
        has_finite_numeric_params(value) &&
        has_boolean_params(value)
    );
}

function is_proof_chamber_preset(value: unknown): value is ProofChamberPreset {
    return (
        is_unknown_record(value) &&
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        is_supported_preset_category(value.category) &&
        is_proof_chamber_engine_state(value.params)
    );
}

export function getUserPresets(): ProofChamberPreset[] {
    try {
        const raw = globalThis.localStorage.getItem(USER_PRESETS_KEY);
        if (raw) {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter(is_proof_chamber_preset) : [];
        }
    } catch {
        /* ignore */
    }
    return [];
}
