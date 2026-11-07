import {
    PERCEPTUAL_CONSTRAINT_IDS,
    type PerceptualConstraint,
    type PerceptualConstraintReading,
    type PerceptualExcludedDimension,
    type UnsupportedPerceptualConstraint,
} from '../models/PerceptualConstraint';

const EXCLUDED_DIMENSIONS: readonly PerceptualExcludedDimension[] = ['low-frequency-band', 'ambience'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function readScope(value: unknown): PerceptualConstraint['scope'] | null {
    if (!isRecord(value)) {
        return null;
    }
    if (value.kind === 'mix') {
        return { kind: 'mix' };
    }
    if (value.kind !== 'tracks' || !Array.isArray(value.trackIds) || !value.trackIds.every(isText)) {
        return null;
    }
    return { kind: 'tracks', trackIds: [...value.trackIds] };
}

function readConstraint(value: unknown): PerceptualConstraint | null {
    if (!isRecord(value) || !isText(value.clause)) {
        return null;
    }
    const { constraintId: storedId, protection } = value;
    if (!isRecord(protection)) {
        return null;
    }
    const constraintId = PERCEPTUAL_CONSTRAINT_IDS.find((id) => id !== 'unsupported' && id === storedId);
    const dimension = EXCLUDED_DIMENSIONS.find((entry) => entry === protection.dimension);
    const scope = readScope(value.scope);
    if (
        constraintId === undefined ||
        constraintId === 'unsupported' ||
        protection.kind !== 'exclude-dimension' ||
        dimension === undefined ||
        scope === null
    ) {
        return null;
    }
    return { constraintId, clause: value.clause, scope, protection: { kind: 'exclude-dimension', dimension } };
}

function readUnsupported(value: unknown): UnsupportedPerceptualConstraint | null {
    if (!isRecord(value) || value.constraintId !== 'unsupported' || !isText(value.clause) || !isText(value.reason)) {
        return null;
    }
    return { constraintId: 'unsupported', clause: value.clause, reason: value.reason };
}

function readEvery<Entry>(value: unknown, read: (entry: unknown) => Entry | null): Entry[] | null {
    if (!Array.isArray(value)) {
        return null;
    }
    const entries: Entry[] = [];
    for (const candidate of value) {
        const entry = read(candidate);
        if (entry === null) {
            return null;
        }
        entries.push(entry);
    }
    return entries;
}

/** A stored reading of a request's perceptual constraints, read whole or not at all. */
export function readPerceptualConstraintReading(value: unknown): PerceptualConstraintReading | null {
    if (!isRecord(value)) {
        return null;
    }
    const constraints = readEvery(value.constraints, readConstraint);
    const unsupported = readEvery(value.unsupported, readUnsupported);
    if (constraints === null || unsupported === null) {
        return null;
    }
    return { constraints, unsupported };
}
