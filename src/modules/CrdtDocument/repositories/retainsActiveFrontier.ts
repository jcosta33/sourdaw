import { type Doc, type Heads, getChangesMetaSince, getHeads, hasHeads } from '@automerge/automerge';

export function retainsActiveFrontier(
    replacement: Doc<unknown>,
    previousHeads: Heads,
    hasKnownHeads = hasHeads
): boolean {
    const replacementHeads = getHeads(replacement);
    const unreachedHeads = new Set(previousHeads);
    for (const head of replacementHeads) {
        unreachedHeads.delete(head);
    }
    if (unreachedHeads.size === 0) {
        return true;
    }
    if (!hasKnownHeads(replacement, previousHeads)) {
        return false;
    }

    const dependencies = new Map(
        getChangesMetaSince(replacement, previousHeads).map((change) => [change.hash, change.deps])
    );
    const visited = new Set<string>();
    const pending = [...replacementHeads];
    while (pending.length > 0 && unreachedHeads.size > 0) {
        const head = pending.pop();
        if (!head || visited.has(head)) {
            continue;
        }
        visited.add(head);
        if (unreachedHeads.delete(head)) {
            continue;
        }
        const dependentHeads = dependencies.get(head);
        if (dependentHeads) {
            pending.push(...dependentHeads);
        }
    }
    return unreachedHeads.size === 0;
}
