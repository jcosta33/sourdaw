import { type Doc, getConflicts, getObjectId } from '@automerge/automerge';

export type AutomergeProjectConflict = {
    conflictIds: readonly string[];
    path: readonly (number | string)[];
    targetIds: readonly string[];
};

type FindAutomergeProjectConflictsInput = {
    document: Readonly<Record<string, unknown>>;
    targetIds?: readonly string[];
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveConflictTargetIds(
    path: readonly (number | string)[],
    nearestObjectId: string | null,
    requestedTargetIds: readonly string[]
): readonly string[] {
    const candidates = new Set<string>();
    if (nearestObjectId) {
        candidates.add(nearestObjectId);
    }
    for (const targetId of requestedTargetIds) {
        if (path.includes(targetId)) {
            candidates.add(targetId);
        }
    }
    return [...candidates].toSorted();
}

export function findAutomergeProjectConflicts(
    input: FindAutomergeProjectConflictsInput
): readonly AutomergeProjectConflict[] {
    const conflicts: AutomergeProjectConflict[] = [];
    const visited = new WeakSet<object>();

    function visit(
        value: Readonly<Record<string, unknown>> | readonly unknown[],
        path: readonly (number | string)[],
        inheritedObjectId: string | null
    ): void {
        if (value instanceof Date || value instanceof Uint8Array) {
            return;
        }
        if (visited.has(value) || getObjectId(value) === null) {
            return;
        }
        visited.add(value);
        const ownObjectId = isRecord(value) && typeof value.id === 'string' ? value.id : null;
        const nearestObjectId = ownObjectId ?? inheritedObjectId;
        for (const rawKey of Object.keys(value)) {
            const key = Array.isArray(value) ? Number(rawKey) : rawKey;
            const childPath = [...path, key];
            const alternatives = getConflicts(value as Doc<Readonly<Record<string, unknown>>>, key);
            const conflictIds = alternatives ? Object.keys(alternatives).toSorted() : [];
            if (conflictIds.length > 1) {
                conflicts.push({
                    conflictIds,
                    path: childPath,
                    targetIds: resolveConflictTargetIds(childPath, nearestObjectId, input.targetIds ?? []),
                });
                continue;
            }
            const child = value[rawKey as keyof typeof value];
            if (Array.isArray(child) || isRecord(child)) {
                visit(child, childPath, nearestObjectId);
            }
        }
    }

    visit(input.document, [], null);
    return conflicts;
}
