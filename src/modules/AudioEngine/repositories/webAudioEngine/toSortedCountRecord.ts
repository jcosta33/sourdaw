export function toSortedCountRecord(counts: Map<string, number>): Record<string, number> {
    return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}
