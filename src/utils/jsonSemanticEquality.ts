import { valuesEqual } from './structuralEquality';

type JsonSerialization = { status: 'serialized'; value: string } | { status: 'undefined' } | { status: 'invalid' };

function serializeJson(value: unknown): JsonSerialization {
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? { status: 'undefined' } : { status: 'serialized', value: serialized };
    } catch {
        return { status: 'invalid' };
    }
}

function parseJson(serialized: string): { valid: true; value: unknown } | { valid: false } {
    try {
        return { valid: true, value: JSON.parse(serialized) };
    } catch {
        return { valid: false };
    }
}

export function jsonNormalizedValue(value: unknown): unknown {
    const serialized = serializeJson(value);
    if (serialized.status !== 'serialized') {
        return undefined;
    }
    const parsed = parseJson(serialized.value);
    return parsed.valid ? parsed.value : undefined;
}

/**
 * Compares values as JSON snapshots. Object key order and omitted object
 * properties follow JSON serialization semantics; array order remains strict.
 */
export function jsonValuesEqual(left: unknown, right: unknown): boolean {
    const leftJson = serializeJson(left);
    const rightJson = serializeJson(right);
    if (leftJson.status === 'invalid' || rightJson.status === 'invalid') {
        return false;
    }
    if (leftJson.status === 'undefined' || rightJson.status === 'undefined') {
        return leftJson.status === rightJson.status;
    }

    const parsedLeft = parseJson(leftJson.value);
    const parsedRight = parseJson(rightJson.value);
    return parsedLeft.valid && parsedRight.valid && valuesEqual(parsedLeft.value, parsedRight.value);
}

/**
 * Checks a live value against a JSON payload captured at action describe time.
 * A live root that JSON omits cannot match a serialized action fingerprint.
 */
export function matchesJsonFingerprint(value: unknown, fingerprint: string): boolean {
    const valueJson = serializeJson(value);
    if (valueJson.status !== 'serialized') {
        return false;
    }

    const parsedValue = parseJson(valueJson.value);
    const parsedFingerprint = parseJson(fingerprint);
    return parsedValue.valid && parsedFingerprint.valid && valuesEqual(parsedValue.value, parsedFingerprint.value);
}
