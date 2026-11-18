export function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Invalid ${label}`);
    }
    return value as Record<string, unknown>;
}

export function integer(value: unknown, label: string, minimum = 0): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`Invalid ${label}`);
    }
    return value;
}

export function spanStart(value: unknown, restoreEndColumn: boolean): number {
    const span = asRecord(value, 'coverage span');
    const start = asRecord(span.start, 'coverage span start');
    const end = asRecord(span.end, 'coverage span end');
    const line = integer(start.line, 'coverage start line', 1);
    integer(start.column, 'coverage start column');
    // Istanbul maps the two endpoints independently. A missing tie-break mapping
    // leaves the end line null and decrements the null column to -1.
    if (end.line === null && end.column === -1) {
        return line;
    }
    integer(end.line, 'coverage end line', 1);
    // Istanbul's source-map remapper uses Infinity for an end column beyond the mapped span.
    // JSON serializes that sentinel as null.
    if (end.column === null) {
        if (restoreEndColumn) {
            end.column = Number.POSITIVE_INFINITY;
        }
    } else {
        integer(end.column, 'coverage end column');
    }
    return line;
}
