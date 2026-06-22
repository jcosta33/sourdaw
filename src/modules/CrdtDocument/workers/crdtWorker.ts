/// <reference lib="webworker" />
/**
 * CRDT Worker — runs Automerge WASM operations off the main thread.
 *
 * `loadBundle` and `mergeBundle` are the two blocking Automerge operations
 * (they parse WASM binary data). Moving them here keeps the main thread free
 * during project load and collaboration patch ingestion.
 *
 * Port protocol (self.onmessage):
 *   ← { id, type: 'loadBundle',  bundle:  [string, Uint8Array][] }
 *   → { id, type: 'loaded',      compacted: [string, Uint8Array][], rootId: string }
 *
 *   ← { id, type: 'mergeBundle', current: [string, Uint8Array][], incoming: [string, Uint8Array][] }
 *   → { id, type: 'merged',      compacted: [string, Uint8Array][], mergedDocIds: string[], newDocIds: string[] }
 *
 *   → { id, type: 'error', message: string }  (on any failure)
 */

import { type Doc, load, loadIncremental, merge, save } from '@automerge/automerge';

const DOC_PREFIX_ROOT = 'root';

// ── loadBundle ────────────────────────────────────────────────────────────────

function processLoad(bundle: Map<string, Uint8Array>): {
    compacted: [string, Uint8Array][];
    rootId: string;
} {
    type AnyDoc = Record<string, unknown>;

    const baseDocs = new Map<string, Uint8Array>();
    const incrementals: Array<{ key: string; bytes: Uint8Array }> = [];

    for (const [key, bytes] of bundle) {
        if (key.includes(':incremental:')) {
            incrementals.push({ key, bytes });
        } else {
            baseDocs.set(key, bytes);
        }
    }

    const docs = new Map<string, Doc<AnyDoc>>();
    let rootId = DOC_PREFIX_ROOT;

    for (const [id, bytes] of baseDocs) {
        docs.set(id, load<AnyDoc>(bytes));
        // Match the root id exactly. `startsWith` also matched sibling ids like
        // `root-2`/`rootBackup`, so with several matches the last-iterated one
        // won and root assignment depended on Map iteration order.
        if (id === DOC_PREFIX_ROOT) {
            rootId = id;
        }
    }

    incrementals.sort((alpha, b) => {
        const tA = parseInt(alpha.key.split(':').pop() ?? '0', 10);
        const tB = parseInt(b.key.split(':').pop() ?? '0', 10);
        return tA - tB;
    });

    for (const { key, bytes } of incrementals) {
        const docId = key.substring(0, key.indexOf(':incremental:'));
        const doc = docs.get(docId);
        if (doc) {
            docs.set(docId, loadIncremental(doc, bytes));
        }
    }

    const compacted: [string, Uint8Array][] = [];
    for (const [id, doc] of docs) {
        compacted.push([id, save(doc)]);
    }

    return { compacted, rootId };
}

// ── mergeBundle ───────────────────────────────────────────────────────────────

function processMerge(
    current: Map<string, Uint8Array>,
    incoming: Map<string, Uint8Array>
): {
    compacted: [string, Uint8Array][];
    mergedDocIds: string[];
    newDocIds: string[];
} {
    type AnyDoc = Record<string, unknown>;

    const docs = new Map<string, Doc<AnyDoc>>();
    for (const [id, bytes] of current) {
        docs.set(id, load<AnyDoc>(bytes));
    }

    const mergedDocIds: string[] = [];
    const newDocIds: string[] = [];

    for (const [id, bytes] of incoming) {
        const incomingDoc = load<AnyDoc>(bytes);
        const local = docs.get(id);
        if (local) {
            docs.set(id, merge(local, incomingDoc));
            mergedDocIds.push(id);
        } else {
            docs.set(id, incomingDoc);
            newDocIds.push(id);
        }
    }

    const compacted: [string, Uint8Array][] = [];
    for (const [id, doc] of docs) {
        compacted.push([id, save(doc)]);
    }

    return { compacted, mergedDocIds, newDocIds };
}

// ── Message dispatcher ────────────────────────────────────────────────────────

type WorkerInMsg =
    | { id: number; type: 'loadBundle'; bundle: [string, Uint8Array][] }
    | { id: number; type: 'mergeBundle'; current: [string, Uint8Array][]; incoming: [string, Uint8Array][] };

self.onmessage = ({ data }: MessageEvent<WorkerInMsg>): void => {
    const { id } = data;
    try {
        if (data.type === 'loadBundle') {
            const bundle = new Map<string, Uint8Array>(data.bundle);
            const result = processLoad(bundle);
            self.postMessage({ id, type: 'loaded', compacted: result.compacted, rootId: result.rootId });
        } else if (data.type === 'mergeBundle') {
            const current = new Map<string, Uint8Array>(data.current);
            const incoming = new Map<string, Uint8Array>(data.incoming);
            const result = processMerge(current, incoming);
            self.postMessage({
                id,
                type: 'merged',
                compacted: result.compacted,
                mergedDocIds: result.mergedDocIds,
                newDocIds: result.newDocIds,
            });
        }
    } catch (error) {
        self.postMessage({ id, type: 'error', message: String(error) });
    }
};
