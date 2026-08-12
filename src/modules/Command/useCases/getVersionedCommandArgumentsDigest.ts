function normalizeJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(normalizeJson);
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .toSorted(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => [key, normalizeJson(nested)])
    );
}

export function getVersionedCommandArgumentsDigest(input: { operation: string; arguments: unknown }): string {
    const serialized = JSON.stringify(normalizeJson(input));
    let hash = 0x811c9dc5;
    for (let index = 0; index < serialized.length; index++) {
        hash ^= serialized.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
