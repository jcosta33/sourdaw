/** Every field of a printed row as alternating key and value, in key order, for reference comparison. */
export function listPrintedFieldRefs(row: Record<string, unknown>): unknown[] {
    return Object.entries(row)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .flatMap(([field, value]) => [field, value]);
}
