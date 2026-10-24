import { isRecord } from '#/utils/structuralEquality';

/** Identified Automation material shares the live project's namespace, including
 * points nested in objects. Canonical gain points can be excluded by their owner. */
export function collectClipSplitIdentityIds(value: unknown, localPoints = new WeakSet<object>()): string[] {
    const ids: string[] = [];
    const visited = new WeakSet<object>();
    function collect(candidate: unknown): void {
        if (Array.isArray(candidate)) {
            for (const item of candidate) {
                collect(item);
            }
            return;
        }
        if (!isRecord(candidate) || visited.has(candidate)) {
            return;
        }
        visited.add(candidate);
        if (!localPoints.has(candidate) && typeof candidate.id === 'string' && candidate.id.length > 0) {
            ids.push(candidate.id);
        }
        for (const child of Object.values(candidate)) {
            collect(child);
        }
    }
    collect(value);
    return ids;
}
