/**
 * Typed readers for `.nam` config JSON, shared by the per-architecture
 * validators: each returns the value it checked or throws the named reason.
 */

export type UnknownRecord = Record<string, unknown>;

const ACTIVATION_NAMES: readonly string[] = [
    'Tanh',
    'Hardtanh',
    'Fasttanh',
    'ReLU',
    'LeakyReLU',
    'PReLU',
    'Sigmoid',
    'SiLU',
    'Hardswish',
    'LeakyHardtanh',
    'LeakyHardTanh',
    'Softsign',
];

export function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireObject(value: unknown, message: string): UnknownRecord {
    if (!isRecord(value)) {
        throw new TypeError(message);
    }
    return value;
}

export function requireNumber(value: UnknownRecord, key: string, message: string): number {
    const raw = value[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new TypeError(message);
    }
    return raw;
}

export function requirePositiveInt(value: UnknownRecord, key: string, message: string): number {
    const raw = requireNumber(value, key, message);
    if (!Number.isInteger(raw) || raw < 1) {
        throw new TypeError(message);
    }
    return raw;
}

export function requireBool(value: UnknownRecord, key: string, message: string): boolean {
    const raw = value[key];
    if (typeof raw !== 'boolean') {
        throw new TypeError(message);
    }
    return raw;
}

export function requireIntArray(value: UnknownRecord, key: string, message: string): number[] {
    const raw = value[key];
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new TypeError(message);
    }
    return raw.map((entry) => {
        if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 1) {
            throw new TypeError(message);
        }
        return entry;
    });
}

export function requireKnownActivation(value: UnknownRecord, message: string): void {
    const raw = value.activation;
    const name = isRecord(raw) ? raw.type : raw;
    if (typeof name !== 'string' || !ACTIVATION_NAMES.includes(name)) {
        throw new Error(message);
    }
    // Mirror the runtime's PReLU parse rejection-for-rejection: it resolves
    // the channel slope as `slopes.get(channel).unwrap_or(slopes[0])`, so a
    // slope-less PReLU would panic on the first sample. A bare `"PReLU"`, a
    // non-numeric `negative_slope`, and an absent, empty or non-numeric
    // `negative_slopes` are each refused here exactly as the native parser
    // refuses them, keeping the import guarantee that a validated file
    // constructs in the runtime.
    if (name === 'PReLU') {
        if (!isRecord(raw)) {
            throw new TypeError('Invalid NAM model: PReLU requires negative_slope or negative_slopes');
        }
        if (raw.negative_slope !== undefined) {
            if (typeof raw.negative_slope !== 'number' || !Number.isFinite(raw.negative_slope)) {
                throw new TypeError('Invalid NAM model: PReLU negative_slope must be a number');
            }
        } else if (!Array.isArray(raw.negative_slopes)) {
            throw new TypeError('Invalid NAM model: PReLU requires negative_slope or negative_slopes');
        } else if (raw.negative_slopes.length === 0) {
            throw new Error('Invalid NAM model: PReLU requires at least one negative slope');
        } else {
            for (const slope of raw.negative_slopes) {
                if (typeof slope !== 'number' || !Number.isFinite(slope)) {
                    throw new TypeError('Invalid NAM model: PReLU slopes must be numbers');
                }
            }
        }
    }
}

/** An optional flag: `fallback` when absent, else it must be a boolean. */
export function readOptionalBool(value: UnknownRecord, key: string, fallback: boolean, message: string): boolean {
    if (value[key] === undefined) {
        return fallback;
    }
    return requireBool(value, key, message);
}
