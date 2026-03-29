/**
 * Proof Chamber preset system — factory presets and user preset storage.
 */

import { type ProofChamberParams, DEFAULT_PARAMS, SPACE_PRESETS, type SpaceType, type AlgorithmType } from '../models/ProofChamberPatch';

export type ProofChamberPreset = {
    id: string;
    name: string;
    category: 'hall' | 'room' | 'plate' | 'spring' | 'creative' | 'user';
    params: ProofChamberParams;
};

// ---------------------------------------------------------------------------
// Factory presets
// ---------------------------------------------------------------------------

export const FACTORY_PRESETS: ProofChamberPreset[] = [
    // Halls
    { id: 'hall-large', name: 'Large Concert Hall', category: 'hall',
        params: { ...DEFAULT_PARAMS, ...SPACE_PRESETS.hall, space: 'hall' as SpaceType, algorithm: 'fdn-8' as AlgorithmType } },
    { id: 'hall-cathedral', name: 'Cathedral', category: 'hall',
        params: { ...DEFAULT_PARAMS, ...SPACE_PRESETS.cathedral, space: 'cathedral' as SpaceType } },
    { id: 'hall-vintage', name: 'Vintage Hall (80s)', category: 'hall',
        params: { ...DEFAULT_PARAMS, ...SPACE_PRESETS.hall, space: 'hall' as SpaceType, vintage: 1 } },

    // Rooms
    { id: 'room-small', name: 'Small Room', category: 'room',
        params: { ...DEFAULT_PARAMS, ...SPACE_PRESETS.room, space: 'room' as SpaceType, algorithm: 'fdn-8' as AlgorithmType } },
    { id: 'room-vocal', name: 'Vocal Room', category: 'room',
        params: { ...DEFAULT_PARAMS, ...SPACE_PRESETS.room, space: 'room' as SpaceType, mix: 0.2, decay: 0.3, highCut: 8000 } },
    { id: 'room-ambient', name: 'Ambient Room', category: 'room',
        params: { ...DEFAULT_PARAMS, ...SPACE_PRESETS.room, space: 'room' as SpaceType, mix: 0.4, decay: 0.5, modDepth: 0.5 } },

    // Plates
    { id: 'plate-classic', name: 'Classic Plate', category: 'plate',
        params: { ...DEFAULT_PARAMS, ...SPACE_PRESETS.plate, space: 'plate' as SpaceType } },
    { id: 'plate-bright', name: 'Bright Plate', category: 'plate',
        params: { ...DEFAULT_PARAMS, ...SPACE_PRESETS.plate, space: 'plate' as SpaceType, highCut: 18000, damping: 0.05 } },
    { id: 'plate-dark', name: 'Dark Plate', category: 'plate',
        params: { ...DEFAULT_PARAMS, ...SPACE_PRESETS.plate, space: 'plate' as SpaceType, highCut: 4000, damping: 0.6, vintage: 2 } },

    // Spring
    { id: 'spring-guitar', name: 'Guitar Spring', category: 'spring',
        params: { ...DEFAULT_PARAMS, ...(SPACE_PRESETS.spring ?? {}), space: 'spring' as SpaceType, algorithm: 'spring' as AlgorithmType } },
    { id: 'spring-dark', name: 'Dark Spring', category: 'spring',
        params: { ...DEFAULT_PARAMS, ...(SPACE_PRESETS.spring ?? {}), space: 'spring' as SpaceType, algorithm: 'spring' as AlgorithmType, damping: 0.6, highCut: 5000, vintage: 2 } },

    // Creative
    { id: 'shimmer-pad', name: 'Shimmer Pad', category: 'creative',
        params: { ...DEFAULT_PARAMS, ...SPACE_PRESETS.shimmer, space: 'shimmer' as SpaceType, shimmer: true, shimmerAmount: 0.35 } },
    { id: 'infinite-hold', name: 'Infinite Hold', category: 'creative',
        params: { ...DEFAULT_PARAMS, ...SPACE_PRESETS.infinite, space: 'infinite' as SpaceType } },
    { id: 'ghost-reverb', name: 'Ghost Reverb', category: 'creative',
        params: { ...DEFAULT_PARAMS, space: 'hall' as SpaceType, decay: 0.9, damping: 0.7, modDepth: 0.8, mix: 0.5, shimmer: true, shimmerAmount: 0.15, vintage: 2 } },
    { id: 'massive-wash', name: 'Massive Wash', category: 'creative',
        params: { ...DEFAULT_PARAMS, space: 'cathedral' as SpaceType, algorithm: 'fdn-16' as AlgorithmType, decay: 0.95, mix: 0.6, modDepth: 0.5, shimmer: true, shimmerAmount: 0.2 } },
];

// ---------------------------------------------------------------------------
// User presets (localStorage)
// ---------------------------------------------------------------------------

const USER_PRESETS_KEY = 'proof-chamber-user-presets';

export function getUserPresets(): ProofChamberPreset[] {
    try {
        const raw = localStorage.getItem(USER_PRESETS_KEY);
        if (raw) {
            return JSON.parse(raw) as ProofChamberPreset[];
        }
    } catch { /* ignore */ }
    return [];
}

export function saveUserPreset(name: string, params: ProofChamberParams): void {
    const presets = getUserPresets();
    presets.push({
        id: `user-${Date.now()}`,
        name,
        category: 'user',
        params: { ...params },
    });
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
}

export function deleteUserPreset(id: string): void {
    const presets = getUserPresets().filter((p) => p.id !== id);
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
}

export function exportPresetJson(params: ProofChamberParams): string {
    return JSON.stringify(params, null, 2);
}

export function importPresetJson(json: string): ProofChamberParams | null {
    try {
        const parsed = JSON.parse(json) as ProofChamberParams;
        if (typeof parsed.mix === 'number' && typeof parsed.decay === 'number') {
            return { ...DEFAULT_PARAMS, ...parsed };
        }
    } catch { /* ignore */ }
    return null;
}
