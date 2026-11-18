import { type Doc, type Heads, free, getChangesMetaSince, getHeads, load, saveSince } from '@automerge/automerge';

export type IncrementalEncodingInput = { id: string; seed: Uint8Array<ArrayBuffer>; heads: Heads; frontier: Heads };
export type EncodedIncremental = { id: string; chunk: Uint8Array<ArrayBuffer>; heads: Heads };
export type IncrementalsEncodedResponse = { type: 'incrementalsEncoded'; documents: EncodedIncremental[] };

export function hasNativeWorkerRequestId(value: unknown): value is { id: number } {
    return (
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        typeof value.id === 'number' &&
        Number.isSafeInteger(value.id) &&
        value.id >= 0
    );
}

export function sameNativeHeads(left: readonly string[], right: readonly string[]): boolean {
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.length === sortedRight.length && sortedLeft.every((head, index) => head === sortedRight[index]);
}

/** A physical backend may know future hashes outside this document's active history. */
export function retainsActiveFrontier(replacement: Doc<unknown>, previousHeads: Heads): boolean {
    const replacementHeads = getHeads(replacement);
    const unreachedHeads = new Set(previousHeads);
    for (const head of replacementHeads) {
        unreachedHeads.delete(head);
    }
    if (unreachedHeads.size === 0) {
        return true;
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

/** Temporary documents never become shadow replicas. */
export function encodeNativeIncrementals(documents: readonly IncrementalEncodingInput[]): EncodedIncremental[] {
    const seen = new Set<string>();
    const result: EncodedIncremental[] = [];
    for (const { id, seed, heads, frontier } of documents) {
        if (seen.has(id)) {
            throw new Error('Duplicate incremental encoding document');
        }
        seen.add(id);
        const doc = load(seed);
        try {
            if (!sameNativeHeads(getHeads(doc), heads)) {
                throw new Error('Incremental encoding seed heads changed');
            }
            result.push({
                id,
                heads: getHeads(doc),
                chunk: Uint8Array.from(saveSince(doc, retainsActiveFrontier(doc, frontier) ? frontier : [])),
            });
        } finally {
            free(doc);
        }
    }
    return result;
}
