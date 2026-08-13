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

export function getExactAgentActionHash(input: { operation: string; arguments: unknown }): string {
    const canonical = JSON.stringify(normalizeJson(input));
    const encoded = new TextEncoder().encode(canonical);
    return `canonical-json-utf8:${[...encoded].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
