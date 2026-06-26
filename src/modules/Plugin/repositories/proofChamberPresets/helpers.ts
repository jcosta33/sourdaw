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

export function getUserPresets(): ProofChamberPreset[] {
    try {
        const raw = window.localStorage.getItem(USER_PRESETS_KEY);
        if (raw) {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as ProofChamberPreset[]) : [];
        }
    } catch {
        /* ignore */
    }
    return [];
}
