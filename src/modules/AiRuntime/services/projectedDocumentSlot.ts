/**
 * Defensive readers for the projected project document an isolated command
 * preview returns.
 *
 * The document is the CRDT root: one key per project slot, each holding the
 * state of the store that owns it. It arrives as `unknown` content and is read
 * back here without a cast, so a slot that is absent, renamed, or malformed
 * reads as `null` and the caller reports it instead of throwing.
 */

export function isProjectedRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The named root slot, or `null` when the document does not carry it. */
export function readProjectedSlot(
    document: Readonly<Record<string, unknown>>,
    slot: string
): Readonly<Record<string, unknown>> | null {
    const value = document[slot];
    if (!isProjectedRecord(value)) {
        return null;
    }
    return value;
}

/** The record entries of an array-valued field, or `null` when it is not an array. */
export function readProjectedEntries(
    record: Readonly<Record<string, unknown>>,
    key: string
): readonly Readonly<Record<string, unknown>>[] | null {
    const value = record[key];
    if (!Array.isArray(value)) {
        return null;
    }
    return value.filter(isProjectedRecord);
}

export function readProjectedString(record: Readonly<Record<string, unknown>>, key: string): string | null {
    const value = record[key];
    if (typeof value !== 'string') {
        return null;
    }
    return value;
}

export function readProjectedNumber(record: Readonly<Record<string, unknown>>, key: string): number | null {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
}
