export function addCountByType(counts: Map<string, number>, type: string, count: number): void {
    if (count === 0) {
        return;
    }
    counts.set(type, (counts.get(type) ?? 0) + count);
}
