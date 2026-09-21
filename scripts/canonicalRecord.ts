/**
 * The one canonical byte form and marker-line grammar for the machine-readable records the delivery
 * scripts post and parse. The finding lineage, the review repair record and the review dossier digest
 * chain all serialize through `canonicalJson`, and every `sourdaw-*-v1` marker shares the same line
 * grammar, so those rules cannot drift into a second, divergent implementation.
 */

import { fail } from './prContract.ts';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Key-sorted, whitespace-free JSON, so one record has exactly one byte representation. */
export function canonicalJson(value: JsonValue): string {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
        const members = Object.entries(value)
            .sort(([left], [right]) => (left < right ? -1 : 1))
            .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
        return `{${members.join(',')}}`;
    }
    return JSON.stringify(value);
}

/**
 * A marker line starts with the marker token at the start of a trimmed line; a line that merely
 * mentions the token inside prose is not a marker, so such prose is ignored like any other.
 */
export function isMarkerLine(line: string, marker: string): boolean {
    if (!line.startsWith(marker)) {
        return false;
    }
    const rest = line.slice(marker.length);
    return rest === '' || /^\s/u.test(rest);
}

/** The last marker line in `body`, already trimmed, or `undefined` when the body carries none. */
export function lastMarkerLine(body: string, marker: string): string | undefined {
    let found: string | undefined;
    for (const line of body.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (isMarkerLine(trimmed, marker)) {
            found = trimmed;
        }
    }
    return found;
}

function isJsonValue(value: unknown): value is JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every((entry) => isJsonValue(entry));
    }
    if (typeof value === 'object') {
        return Object.values(value).every((entry) => isJsonValue(entry));
    }
    return false;
}

/**
 * Parsed only when the payload is already the canonical byte form. `JSON.parse` collapses a repeated
 * member to its last occurrence, so `Object.keys` can no longer see the repetition: re-encoding the
 * parsed value and holding it against the raw bytes is what refuses a duplicate key, a reordered key
 * or stray whitespace. A hand-edited payload therefore cannot be read last-wins into a record whose
 * bytes this script never printed.
 */
export function parseMarkerPayload(payload: string, label: string): unknown {
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch {
        return fail(`${label} marker line is not valid JSON`);
    }
    if (!isJsonValue(parsed)) {
        return fail(`${label} marker line is not valid JSON`);
    }
    if (canonicalJson(parsed) !== payload) {
        return fail(`${label} marker line is not the canonical key-sorted, whitespace-free JSON record`);
    }
    return parsed;
}
