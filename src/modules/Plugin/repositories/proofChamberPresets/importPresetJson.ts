import {
    type ProofChamberEngineState,
    type SpaceType,
    type ProofChamberAlgorithm,
    DEFAULT_PARAMS,
} from '../../models/ProofChamberState';

const SPACE_TYPES: readonly SpaceType[] = [
    'hall',
    'room',
    'plate',
    'chamber',
    'cathedral',
    'shimmer',
    'infinite',
    'spring',
];

const ALGORITHMS: readonly ProofChamberAlgorithm[] = ['plate', 'fdn-8', 'fdn-16', 'spring'];

/** Numeric param fields with their inclusive accepted ranges. */
const NUMERIC_RANGES: Record<string, readonly [number, number]> = {
    mix: [0, 1],
    decay: [0, 1],
    damping: [0, 1],
    predelay: [0, 500],
    size: [0, 1],
    modRate: [0, 20],
    modDepth: [0, 1],
    diffusion: [0, 1],
    highCut: [20, 20000],
    lowCut: [20, 20000],
    width: [0, 2],
    shimmerAmount: [0, 1],
    shimmerPitch: [0, 1],
    gravity: [-1, 1],
    earlyLateBalance: [0, 1],
    vintage: [0, 2],
};

const BOOLEAN_FIELDS: readonly string[] = ['freeze', 'shimmer', 'saturation'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and validate an exported ProofChamber preset.
 *
 * Every field present in the input is validated against the full param schema
 * (numeric ranges, boolean type, enum membership). A present-but-invalid value
 * rejects the whole import (returns null). Absent fields fall back to
 * DEFAULT_PARAMS, and unknown keys are dropped rather than merged.
 */
export function importPresetJson(json: string): ProofChamberEngineState | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return null;
    }

    if (!isRecord(parsed)) {
        return null;
    }

    // A real preset must at least carry numeric mix and decay (preserves the
    // original gate that distinguished a preset payload from arbitrary JSON).
    if (typeof parsed.mix !== 'number' || typeof parsed.decay !== 'number') {
        return null;
    }

    const result: ProofChamberEngineState = { ...DEFAULT_PARAMS };

    for (const [key, range] of Object.entries(NUMERIC_RANGES)) {
        if (key in parsed) {
            const value = parsed[key];
            if (typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1]) {
                return null;
            }
            (result as Record<string, unknown>)[key] = value;
        }
    }

    for (const key of BOOLEAN_FIELDS) {
        if (key in parsed) {
            const value = parsed[key];
            if (typeof value !== 'boolean') {
                return null;
            }
            (result as Record<string, unknown>)[key] = value;
        }
    }

    if ('space' in parsed) {
        const value = parsed.space;
        if (typeof value !== 'string' || !SPACE_TYPES.includes(value as SpaceType)) {
            return null;
        }
        result.space = value as SpaceType;
    }

    if ('algorithm' in parsed) {
        const value = parsed.algorithm;
        if (typeof value !== 'string' || !ALGORITHMS.includes(value as ProofChamberAlgorithm)) {
            return null;
        }
        result.algorithm = value as ProofChamberAlgorithm;
    }

    return result;
}
