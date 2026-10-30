import { isRecord } from '#/utils/structuralEquality';

export function hasFiniteNumbers(value: unknown): boolean {
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every(hasFiniteNumbers);
    }
    if (isRecord(value)) {
        return Object.values(value).every(hasFiniteNumbers);
    }
    return true;
}
