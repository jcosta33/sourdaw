import { free, getHeads, load, saveSince } from '@automerge/automerge';

import {
    retainsActiveFrontier,
    sameNativeHeads,
    type EncodedIncremental,
    type IncrementalEncodingInput,
} from '../models/NativeIncrementalEncoding';

/** Stateless Worker operation; temporary documents never become shadow replicas. */
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
