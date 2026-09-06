/// <reference lib="webworker" />
/**
 * CRDT Worker — runs Automerge WASM operations off the main thread.
 *
 * `loadBundle`, `mergeBundle` and `compactShadow` are the blocking Automerge
 * operations (they parse or re-encode WASM binary data). Moving them here keeps
 * the main thread free during project load, collaboration patch ingestion and
 * periodic compaction.
 *
 * Port protocol (self.onmessage):
 *   ← { id, type: 'loadBundle',  bundle:  [string, Uint8Array][], retainShadow?: boolean }
 *   → { id, type: 'loaded',      compacted: [string, Uint8Array][], rootId: string }
 *
 *   ← { id, type: 'mergeBundle', current: [string, Uint8Array][], incoming: [string, Uint8Array][] }
 *   → { id, type: 'merged',      compacted: [string, Uint8Array][], mergedDocIds: string[], newDocIds: string[] }
 *
 *   ← { id, type: 'compactShadow', seeds: [string, Uint8Array][], deltas: [string, Uint8Array][],
 *        removedDocIds: string[], expectedHeads: [string, string[]][] }
 *   → { id, type: 'compacted',     bundle: [string, Uint8Array][] }
 *   → { id, type: 'compactStale',  reason: string }
 *
 *   ← { id, type: 'inspectCheckpointRootMedia', rootBytes: Uint8Array }
 *   → { id, type: 'checkpointRootMediaInspected', audioBufferIds: string[] }
 *
 *   → { id, type: 'error', message: string }  (on any failure)
 */

import { type Doc, type Heads, getHeads, load, loadIncremental, merge, save } from '@automerge/automerge';

import { inspectCheckpointRootMedia } from './checkpointRootMedia';

const DOC_PREFIX_ROOT = 'root';

type AnyShadowDoc = Record<string, unknown>;

/**
 * Worker-side replica of the repository's live documents.
 *
 * `loadBundle` (when the caller marks the bundle as the state it is about to
 * install) and `mergeBundle` already materialise every document here, so
 * retaining them is free. `compactShadow` then re-encodes the replica instead of
 * the main thread encoding its own copies — the CC-8 offload. The replica is
 * only ever trusted when its per-document heads match the heads the caller
 * observed on its live documents, so a drifted replica can never be persisted.
 */
const shadowDocs = new Map<string, Doc<AnyShadowDoc>>();

function replaceShadowDocs(docs: Map<string, Doc<AnyShadowDoc>>): void {
    shadowDocs.clear();
    for (const [id, doc] of docs) {
        shadowDocs.set(id, doc);
    }
}

function haveSameHeads(left: Heads, right: Heads): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.every((hash, index) => hash === sortedRight[index]);
}

// ── loadBundle ────────────────────────────────────────────────────────────────

export function processLoad(bundle: Map<string, Uint8Array>): {
    compacted: [string, Uint8Array][];
    rootId: string;
    documents: Map<string, Doc<AnyShadowDoc>>;
} {
    type AnyDoc = AnyShadowDoc;

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

    // Order by the full `${millis}-${seqBase36}` token, not just `parseInt` of
    // its millis prefix — same-millisecond chunks must replay in `seq` order.
    // Inlined (not imported) to keep this worker's bundle free of main-thread
    // deps; mirrors `compareIncrementalKeys` in repositories/crdtPersistence.
    incrementals.sort((alpha, b) => {
        const tokenA = alpha.key.split(':').pop() ?? '';
        const tokenB = b.key.split(':').pop() ?? '';
        const dashA = tokenA.indexOf('-');
        const dashB = tokenB.indexOf('-');
        const millisA = parseInt(dashA === -1 ? tokenA : tokenA.slice(0, dashA), 10) || 0;
        const millisB = parseInt(dashB === -1 ? tokenB : tokenB.slice(0, dashB), 10) || 0;
        if (millisA !== millisB) {
            return millisA - millisB;
        }
        const seqA = dashA === -1 ? 0 : parseInt(tokenA.slice(dashA + 1), 36) || 0;
        const seqB = dashB === -1 ? 0 : parseInt(tokenB.slice(dashB + 1), 36) || 0;
        return seqA - seqB;
    });

    for (const { key, bytes } of incrementals) {
        const docId = key.substring(0, key.indexOf(':incremental:'));
        const doc = docs.get(docId);
        if (!doc) {
            throw new Error(`[CrdtWorker] Incremental chunk ${key} references missing base document ${docId}`);
        }
        docs.set(docId, loadIncremental(doc, bytes));
    }

    const compacted: [string, Uint8Array][] = [];
    for (const [id, doc] of docs) {
        compacted.push([id, save(doc)]);
    }

    return { compacted, rootId, documents: docs };
}

// ── mergeBundle ───────────────────────────────────────────────────────────────

function processMerge(
    current: Map<string, Uint8Array>,
    incoming: Map<string, Uint8Array>
): {
    compacted: [string, Uint8Array][];
    mergedDocIds: string[];
    newDocIds: string[];
    documents: Map<string, Doc<AnyShadowDoc>>;
} {
    type AnyDoc = AnyShadowDoc;

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

    return { compacted, mergedDocIds, newDocIds, documents: docs };
}

// ── compactShadow ─────────────────────────────────────────────────────────────

type CompactShadowInput = {
    /** Full document saves for ids the replica does not hold (or must relearn). */
    seeds: Map<string, Uint8Array>;
    /** `saveSince` deltas for ids the replica already holds, keyed by doc id. */
    deltas: Map<string, Uint8Array>;
    /** Ids the caller has dropped since the replica was last updated. */
    removedDocIds: string[];
    /** Heads the caller observed on its own live documents, per doc id. */
    expectedHeads: Map<string, Heads>;
};

type CompactShadowOutput =
    { status: 'compacted'; bundle: [string, Uint8Array][] } | { status: 'stale'; reason: string };

export function processCompactShadow({
    seeds,
    deltas,
    removedDocIds,
    expectedHeads,
}: CompactShadowInput): CompactShadowOutput {
    for (const id of removedDocIds) {
        shadowDocs.delete(id);
    }
    for (const [id, bytes] of seeds) {
        shadowDocs.set(id, load<AnyShadowDoc>(bytes));
    }
    for (const [id, bytes] of deltas) {
        const doc = shadowDocs.get(id);
        if (!doc) {
            return { status: 'stale', reason: `no replica for ${id}` };
        }
        shadowDocs.set(id, loadIncremental(doc, bytes));
    }

    if (shadowDocs.size !== expectedHeads.size) {
        return { status: 'stale', reason: `replica holds ${shadowDocs.size} docs, caller holds ${expectedHeads.size}` };
    }

    // The replica is only allowed to produce persisted bytes when it provably
    // holds the same change graph as the caller's live documents. Heads are
    // content hashes, so an equal head set means an equal change set.
    for (const [id, doc] of shadowDocs) {
        const expected = expectedHeads.get(id);
        if (!expected || !haveSameHeads(getHeads(doc), expected)) {
            return { status: 'stale', reason: `heads diverged for ${id}` };
        }
    }

    const bundle: [string, Uint8Array][] = [];
    for (const [id, doc] of shadowDocs) {
        bundle.push([id, save(doc)]);
    }
    return { status: 'compacted', bundle };
}

// ── Message dispatcher ────────────────────────────────────────────────────────

type WorkerInMsg =
    | { id: number; type: 'loadBundle'; bundle: [string, Uint8Array][]; retainShadow?: boolean }
    | { id: number; type: 'mergeBundle'; current: [string, Uint8Array][]; incoming: [string, Uint8Array][] }
    | {
          id: number;
          type: 'compactShadow';
          seeds: [string, Uint8Array][];
          deltas: [string, Uint8Array][];
          removedDocIds: string[];
          expectedHeads: [string, Heads][];
      }
    | { id: number; type: 'inspectCheckpointRootMedia'; rootBytes: Uint8Array };

self.onmessage = ({ data }: MessageEvent<WorkerInMsg>): void => {
    const { id } = data;
    try {
        if (data.type === 'loadBundle') {
            const bundle = new Map<string, Uint8Array>(data.bundle);
            const result = processLoad(bundle);
            if (data.retainShadow === true) {
                replaceShadowDocs(result.documents);
            }
            self.postMessage({ id, type: 'loaded', compacted: result.compacted, rootId: result.rootId });
        } else if (data.type === 'compactShadow') {
            const result = processCompactShadow({
                seeds: new Map<string, Uint8Array>(data.seeds),
                deltas: new Map<string, Uint8Array>(data.deltas),
                removedDocIds: data.removedDocIds,
                expectedHeads: new Map<string, Heads>(data.expectedHeads),
            });
            if (result.status === 'stale') {
                self.postMessage({ id, type: 'compactStale', reason: result.reason });
            } else {
                self.postMessage({ id, type: 'compacted', bundle: result.bundle });
            }
        } else if (data.type === 'mergeBundle') {
            const current = new Map<string, Uint8Array>(data.current);
            const incoming = new Map<string, Uint8Array>(data.incoming);
            const result = processMerge(current, incoming);
            replaceShadowDocs(result.documents);
            self.postMessage({
                id,
                type: 'merged',
                compacted: result.compacted,
                mergedDocIds: result.mergedDocIds,
                newDocIds: result.newDocIds,
            });
        } else if (data.type === 'inspectCheckpointRootMedia') {
            const result = inspectCheckpointRootMedia(data.rootBytes);
            self.postMessage({ id, type: 'checkpointRootMediaInspected', audioBufferIds: result.audioBufferIds });
        } else {
            throw new Error('[CrdtWorker] Unsupported request type');
        }
    } catch (error) {
        self.postMessage({ id, type: 'error', message: String(error) });
    }
};
