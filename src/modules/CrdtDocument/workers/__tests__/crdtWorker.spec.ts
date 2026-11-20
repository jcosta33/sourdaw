import {
    type Doc,
    type Heads,
    change,
    clone,
    getBackend,
    getChangesSince,
    getHeads,
    getMissingDeps,
    init,
    load,
    loadIncremental,
    save,
    saveSince,
    view,
} from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type EncodedIncrementalFrames,
    type IncrementalEncodingInput,
} from '../../models/IncrementalPersistenceEncoding';
import { processLoad } from '../crdtWorker';

type AnyDoc = Record<string, unknown>;

type LoadedResponse = {
    id: number;
    type: 'loaded';
    compacted: [string, Uint8Array][];
    rootId: string;
};

type MergedResponse = {
    id: number;
    type: 'merged';
    compacted: [string, Uint8Array][];
    mergedDocIds: string[];
    newDocIds: string[];
};

type ErrorResponse = { id: number; type: 'error'; message: string };

type CompactedResponse = { id: number; type: 'compacted'; bundle: [string, Uint8Array][] };

type CompactStaleResponse = { id: number; type: 'compactStale'; reason: string };

type IncrementalsEncodedResponse = { id: number; type: 'incrementalsEncoded'; documents: EncodedIncrementalFrames[] };

type WorkerResponse =
    | LoadedResponse
    | MergedResponse
    | ErrorResponse
    | CompactedResponse
    | CompactStaleResponse
    | IncrementalsEncodedResponse;

/** Save a fresh doc with a fixed actor so byte output is deterministic. */
function freshDoc(actor: string, mutate?: (doc: AnyDoc) => void): Uint8Array {
    let doc = init<AnyDoc>(actor);
    if (mutate) {
        doc = change(doc, mutate);
    }
    return save(doc);
}

describe('crdtWorker processLoad', () => {
    it('rejects an orphan incremental before compaction', () => {
        const root = freshDoc('aaaaaaaaaaaaaaaa', (doc) => {
            doc.seed = true;
        });
        const bundle = new Map([
            ['root', root],
            ['orphan-child:incremental:1-0', new Uint8Array([1, 2, 3])],
        ]);

        expect(() => processLoad(bundle)).toThrow('missing base document');
    });

    it('compacts a single base document unchanged and reports it as root', () => {
        const root = freshDoc('aaaaaaaaaaaaaaaa', (doc) => {
            doc.seed = true;
        });
        const bundle = new Map([['root', root]]);

        const result = processLoad(bundle);

        expect(result.rootId).toBe('root');
        expect(result.compacted).toHaveLength(1);
        expect(result.compacted[0]![0]).toBe('root');
        // A round-trip through save must still load to the same content.
        const reloaded = load<AnyDoc>(result.compacted[0]![1]);
        expect(reloaded.seed).toBe(true);
    });

    it('replays incremental chunks onto their owning base document', () => {
        const base = freshDoc('aaaaaaaaaaaaaaaa', (doc) => {
            doc.count = 0;
        });
        // Apply a change, then produce a save() that represents a full doc state
        // to feed as an "incremental". processLoad replays it via loadIncremental.
        let evolved = load<AnyDoc>(base);
        evolved = change(evolved, (doc) => {
            doc.count = 5;
        });
        const incrementalBytes = save(evolved);

        const bundle = new Map([
            ['root', base],
            ['root:incremental:100-0', incrementalBytes],
        ]);

        const result = processLoad(bundle);
        const reloaded = load<AnyDoc>(result.compacted[0]![1]);
        expect(reloaded.count).toBe(5);
    });

    it('replays same-millisecond chunks in seq order, not iteration order', () => {
        const base = freshDoc('aaaaaaaaaaaaaaaa', (doc) => {
            doc.steps = [] as number[];
        });

        // Build three sequential states. Each save() carries all prior changes,
        // so replaying them in seq order lands at the final state regardless.
        let step1 = load<AnyDoc>(base);
        step1 = change(step1, (doc) => {
            doc.steps = [1];
        });
        let step2 = load<AnyDoc>(save(step1));
        step2 = change(step2, (doc) => {
            doc.steps = [1, 2];
        });
        let step3 = load<AnyDoc>(save(step2));
        step3 = change(step3, (doc) => {
            doc.steps = [1, 2, 3];
        });

        // Same millis (1000), differing seq (0,1,2). Deliberately hand the Map
        // the chunks OUT of seq order; the worker must sort by seq before replay.
        const bundle = new Map([
            ['root', base],
            ['root:incremental:1000-2', save(step3)],
            ['root:incremental:1000-0', save(step1)],
            ['root:incremental:1000-1', save(step2)],
        ]);

        const result = processLoad(bundle);
        const reloaded = load<AnyDoc>(result.compacted[0]![1]);
        expect(reloaded.steps).toEqual([1, 2, 3]);
    });

    it('orders incrementals across different milliseconds by timestamp first', () => {
        const base = freshDoc('aaaaaaaaaaaaaaaa', (doc) => {
            doc.steps = [] as number[];
        });
        // Two states at different millis; the later state must win the replay.
        let early = load<AnyDoc>(base);
        early = change(early, (doc) => {
            doc.steps = [1];
        });
        let later = load<AnyDoc>(save(early));
        later = change(later, (doc) => {
            doc.steps = [1, 2];
        });

        // Insert the later-millis chunk FIRST; the sort must reorder by millis.
        const bundle = new Map([
            ['root', base],
            ['root:incremental:2000-0', save(later)],
            ['root:incremental:1000-0', save(early)],
        ]);

        const result = processLoad(bundle);
        const reloaded = load<AnyDoc>(result.compacted[0]![1]);
        expect(reloaded.steps).toEqual([1, 2]);
    });

    it('selects the exact "root" id, not a sibling whose name starts with "root"', () => {
        const root = freshDoc('aaaaaaaaaaaaaaaa', (doc) => {
            doc.isRoot = true;
        });
        const backup = freshDoc('bbbbbbbbbbbbbbbb', (doc) => {
            doc.isRoot = false;
        });
        // Map iterates in insertion order; insert the non-root sibling LAST so a
        // naive `startsWith('root')` would incorrectly pick it as rootId.
        const bundle = new Map([
            ['root', root],
            ['rootBackup', backup],
        ]);

        const result = processLoad(bundle);

        expect(result.rootId).toBe('root');
        expect(result.compacted).toHaveLength(2);
    });

    it('compacts multiple independent documents and keeps each id distinct', () => {
        const root = freshDoc('aaaaaaaaaaaaaaaa', (doc) => {
            doc.role = 'root';
        });
        const child = freshDoc('cccccccccccccccc', (doc) => {
            doc.role = 'child';
        });

        const bundle = new Map([
            ['root', root],
            ['branch_local', child],
        ]);

        const result = processLoad(bundle);

        expect(result.compacted).toHaveLength(2);
        const byId = new Map(result.compacted);
        expect(load<AnyDoc>(byId.get('root')!).role).toBe('root');
        expect(load<AnyDoc>(byId.get('branch_local')!).role).toBe('child');
    });
});

// ─── processMerge & message dispatcher ──────────────────────────────────────
//
// processMerge is a private module function. The dispatcher (`self.onmessage`)
// is the public entry that routes loadBundle/mergeBundle and serializes errors.
// We exercise the merge contract through the dispatcher so we cover both the
// routing logic and the Automerge merge semantics (merged docs vs new docs).

describe('crdtWorker message dispatcher', () => {
    const originalPostMessage = (self as unknown as { postMessage?: unknown }).postMessage;
    let posted: WorkerResponse[];
    let postedTransfers: Transferable[] | undefined;
    let onmessage: ((event: { data: unknown }) => void) | null;

    beforeEach(async () => {
        posted = [];
        postedTransfers = undefined;
        const postMessage = vi.fn((message: unknown, transfer?: Transferable[]) => {
            posted.push(message as WorkerResponse);
            postedTransfers = transfer;
        });
        (self as unknown as { postMessage: unknown }).postMessage = postMessage;
        // Importing the module installs self.onmessage and references the live
        // `self` binding. Reset modules so each test re-installs a clean handler.
        vi.resetModules();
        await import('../crdtWorker');
        onmessage = (self as unknown as { onmessage: typeof onmessage }).onmessage;
    });

    afterEach(() => {
        (self as unknown as { postMessage?: unknown }).postMessage = originalPostMessage;
    });

    it('routes a loadBundle to a "loaded" response with the compacted bundle and root id', () => {
        const root = freshDoc('aaaaaaaaaaaaaaaa', (doc) => {
            doc.loaded = true;
        });
        onmessage!({
            data: { id: 7, type: 'loadBundle', bundle: [['root', root]] },
        });

        expect(posted).toHaveLength(1);
        const response = posted[0]!;
        expect(response).toMatchObject({ id: 7, type: 'loaded', rootId: 'root' });
        if (response.type !== 'loaded') {
            throw new Error('expected loaded');
        }
        expect(response.compacted).toHaveLength(1);
        expect(load<AnyDoc>(response.compacted[0]![1]).loaded).toBe(true);
    });

    it('merges an incoming doc over a current doc and reports it as merged', () => {
        const base = freshDoc('aaaaaaaaaaaaaaaa', (doc) => {
            doc.shared = 'base';
        });
        // Build a divergent copy under a different actor and add a field.
        let incoming = load<AnyDoc>(base);
        incoming = change(incoming, (doc) => {
            doc.fromPeer = true;
        });
        const incomingBytes = save(incoming);

        onmessage!({
            data: {
                id: 3,
                type: 'mergeBundle',
                current: [['root', base]],
                incoming: [['root', incomingBytes]],
            },
        });

        const response = posted[0]!;
        expect(response.type).toBe('merged');
        if (response.type !== 'merged') {
            throw new Error('expected merged');
        }
        expect(response.id).toBe(3);
        expect(response.mergedDocIds).toEqual(['root']);
        expect(response.newDocIds).toEqual([]);
        const merged = load<AnyDoc>(response.compacted[0]![1]);
        // The base value survives and the peer's change is folded in.
        expect(merged.shared).toBe('base');
        expect(merged.fromPeer).toBe(true);
    });

    it('adds a brand-new incoming doc as new rather than merging', () => {
        const current = freshDoc('aaaaaaaaaaaaaaaa', (doc) => {
            doc.role = 'existing';
        });
        const incoming = freshDoc('bbbbbbbbbbbbbbbb', (doc) => {
            doc.role = 'incoming';
        });

        onmessage!({
            data: {
                id: 9,
                type: 'mergeBundle',
                current: [['root', current]],
                incoming: [['branch_new', incoming]],
            },
        });

        const response = posted[0]!;
        expect(response.type).toBe('merged');
        if (response.type !== 'merged') {
            throw new Error('expected merged');
        }
        expect(response.mergedDocIds).toEqual([]);
        expect(response.newDocIds).toEqual(['branch_new']);
        // Both documents survive in the compacted output.
        const byId = new Map(response.compacted);
        expect(byId.has('root')).toBe(true);
        expect(byId.has('branch_new')).toBe(true);
    });

    it('reports an "error" response when loadBundle references a missing base document', () => {
        onmessage!({
            data: {
                id: 11,
                type: 'loadBundle',
                bundle: [['root:incremental:1-0', new Uint8Array([1, 2, 3])]],
            },
        });

        expect(posted).toHaveLength(1);
        const response = posted[0]!;
        expect(response).toMatchObject({ id: 11, type: 'error' });
        if (response.type !== 'error') {
            throw new Error('expected error');
        }
        expect(response.message).toContain('missing base document');
    });

    // ── compactShadow (CC-8) ──────────────────────────────────────────────
    //
    // The worker keeps a replica of the caller's documents so a full save can
    // be re-encoded here instead of on the main thread. The replica is only
    // ever allowed to produce bytes when its heads prove it holds the caller's
    // exact change set.

    type SeedReplicaOutput = { rootBytes: Uint8Array; rootHeads: string[] };

    function seedReplica(mutate: (doc: AnyDoc) => void): SeedReplicaOutput {
        const rootBytes = freshDoc('aaaaaaaaaaaaaaaa', mutate);
        onmessage!({ data: { id: 1, type: 'loadBundle', bundle: [['root', rootBytes]], retainShadow: true } });
        posted.length = 0;
        return { rootBytes, rootHeads: getHeads(load<AnyDoc>(rootBytes)) };
    }

    function incrementalInput(id: string, document: Doc<AnyDoc>, frontier: Heads): IncrementalEncodingInput {
        return {
            id,
            seed: Uint8Array.from(getBackend(document).saveNoCompress()),
            heads: getHeads(document),
            frontier,
        };
    }

    it('encodes exact incremental bytes against a durable baseline and keeps the compaction shadow', () => {
        const { rootBytes, rootHeads } = seedReplica((doc) => {
            doc.baseline = 'durable';
        });
        const evolved = change(load<AnyDoc>(rootBytes), (doc) => {
            doc.edited = true;
        });
        const child = change(init<AnyDoc>(), (doc) => {
            doc.child = true;
        });
        onmessage!({
            data: {
                id: 30,
                type: 'encodeIncrementals',
                documents: [incrementalInput('root', evolved, rootHeads), incrementalInput('branch_child', child, [])],
            },
        });

        expect(posted).toHaveLength(1);
        const response = posted[0];
        expect(response).toMatchObject({ id: 30, type: 'incrementalsEncoded' });
        if (response?.type !== 'incrementalsEncoded') {
            throw new Error('Expected encoded incremental documents');
        }
        const [rootOutput, childOutput] = response.documents;
        if (!rootOutput || !childOutput) {
            throw new Error('Expected root and child output');
        }
        expect(response.documents).toEqual([
            { id: 'root', frames: getChangesSince(evolved, rootHeads), heads: getHeads(evolved) },
            { id: 'branch_child', frames: getChangesSince(child, []), heads: getHeads(child) },
        ]);
        const [rootFrame] = rootOutput.frames;
        const [childFrame] = childOutput.frames;
        if (!rootFrame || !childFrame) {
            throw new Error('Expected both native change frames');
        }
        expect(postedTransfers).toHaveLength(2);
        expect(postedTransfers?.[0]).toBe(rootFrame.buffer);
        expect(postedTransfers?.[1]).toBe(childFrame.buffer);
        expect(rootFrame.buffer).not.toBe(childFrame.buffer);

        const standalone = loadIncremental(init<AnyDoc>(), rootFrame);
        expect(getHeads(standalone)).toEqual([]);
        expect(getMissingDeps(standalone, rootHeads)).toEqual(rootHeads);
        const replay = loadIncremental(load<AnyDoc>(rootBytes), rootFrame);
        expect(getHeads(replay)).toEqual(getHeads(evolved));
        expect(replay).toEqual({ baseline: 'durable', edited: true });

        onmessage!({
            data: {
                id: 31,
                type: 'compactShadow',
                seeds: [],
                deltas: [],
                removedDocIds: [],
                expectedHeads: [['root', rootHeads]],
            },
        });
        const compacted = posted[1];
        expect(compacted).toMatchObject({ id: 31, type: 'compacted' });
        if (compacted?.type !== 'compacted') {
            throw new Error('Expected the existing shadow to compact');
        }
        expect(compacted.bundle).toEqual([['root', rootBytes]]);
    });

    it('encodes from an empty frontier when only part of the old frontier is active', () => {
        const original = change(init<AnyDoc>(), (doc) => {
            doc.baseline = true;
        });
        const earlier = getHeads(original);
        const later = change(original, (doc) => {
            doc.future = true;
        });
        const historical = clone(view(later, earlier));
        onmessage!({
            data: {
                id: 32,
                type: 'encodeIncrementals',
                documents: [incrementalInput('root', historical, [...earlier, ...getHeads(later)])],
            },
        });

        expect(posted).toEqual([
            {
                id: 32,
                type: 'incrementalsEncoded',
                documents: [{ id: 'root', frames: getChangesSince(historical, []), heads: earlier }],
            },
        ]);
    });

    it('keeps an unchanged active frontier even when the seed has unrelated pending changes', () => {
        const prerequisite = change(init<AnyDoc>(), (doc) => {
            doc.missing = true;
        });
        const prior = getHeads(prerequisite);
        const later = change(prerequisite, (doc) => {
            doc.pending = true;
        });
        const active = change(init<AnyDoc>(), (doc) => {
            doc.active = true;
        });
        const seed = loadIncremental(active, saveSince(later, prior));
        const activeHeads = getHeads(seed);
        expect(getMissingDeps(seed, activeHeads)).toEqual(prior);
        onmessage!({
            data: { id: 33, type: 'encodeIncrementals', documents: [incrementalInput('root', seed, activeHeads)] },
        });

        expect(posted).toEqual([
            {
                id: 33,
                type: 'incrementalsEncoded',
                documents: [{ id: 'root', frames: [], heads: activeHeads }],
            },
        ]);
    });

    it('rejects incremental encoding when the supplied heads are an inactive ancestor of the seed', () => {
        const root = change(init<AnyDoc>(), (doc) => {
            doc.baseline = true;
        });
        const prior = getHeads(root);
        const evolved = change(root, (doc) => {
            doc.newer = true;
        });
        const input = { ...incrementalInput('root', evolved, prior), heads: prior };
        onmessage!({ data: { id: 34, type: 'encodeIncrementals', documents: [input] } });

        expect(posted).toEqual([{ id: 34, type: 'error', message: expect.stringContaining('seed heads changed') }]);
    });

    it('rejects duplicate incremental document IDs without posting a partial batch', () => {
        const input = incrementalInput('root', init<AnyDoc>(), []);
        onmessage!({ data: { id: 35, type: 'encodeIncrementals', documents: [input, input] } });

        expect(posted).toEqual([{ id: 35, type: 'error', message: expect.stringContaining('Duplicate incremental') }]);
    });

    it('re-encodes its replica when the caller reports matching heads', () => {
        const { rootHeads } = seedReplica((doc) => {
            doc.seed = 'replica';
        });

        onmessage!({
            data: {
                id: 20,
                type: 'compactShadow',
                seeds: [],
                deltas: [],
                removedDocIds: [],
                expectedHeads: [['root', rootHeads]],
            },
        });

        const response = posted[0]!;
        if (response.type !== 'compacted') {
            throw new Error(`expected compacted, got ${response.type}`);
        }
        expect(response.id).toBe(20);
        expect(load<AnyDoc>(new Map(response.bundle).get('root')!).seed).toBe('replica');
    });

    it('applies a saveSince delta onto the replica before encoding', () => {
        const { rootBytes, rootHeads } = seedReplica((doc) => {
            doc.seed = 'replica';
        });
        const evolved = change(load<AnyDoc>(rootBytes), (doc) => {
            doc.later = 'edit';
        });

        onmessage!({
            data: {
                id: 21,
                type: 'compactShadow',
                seeds: [],
                deltas: [['root', saveSince(evolved, rootHeads)]],
                removedDocIds: [],
                expectedHeads: [['root', getHeads(evolved)]],
            },
        });

        const response = posted[0]!;
        if (response.type !== 'compacted') {
            throw new Error(`expected compacted, got ${response.type}`);
        }
        expect(load<AnyDoc>(new Map(response.bundle).get('root')!)).toMatchObject({
            seed: 'replica',
            later: 'edit',
        });
    });

    it('refuses to encode when the replica lags the heads the caller reports', () => {
        const { rootBytes, rootHeads } = seedReplica((doc) => {
            doc.seed = 'replica';
        });
        const evolved = change(load<AnyDoc>(rootBytes), (doc) => {
            doc.unshipped = true;
        });

        // The caller's document moved on but no delta was shipped.
        onmessage!({
            data: {
                id: 22,
                type: 'compactShadow',
                seeds: [],
                deltas: [],
                removedDocIds: [],
                expectedHeads: [['root', getHeads(evolved)]],
            },
        });

        const response = posted[0]!;
        if (response.type !== 'compactStale') {
            throw new Error(`expected compactStale, got ${response.type}`);
        }
        expect(response.reason).toContain('heads diverged for root');
        expect(rootHeads).not.toEqual(getHeads(evolved));
    });

    it('refuses to encode when the caller holds a document the replica does not', () => {
        const { rootHeads } = seedReplica((doc) => {
            doc.seed = 'replica';
        });
        const branch = load<AnyDoc>(
            freshDoc('bbbbbbbbbbbbbbbb', (doc) => {
                doc.branch = true;
            })
        );

        onmessage!({
            data: {
                id: 23,
                type: 'compactShadow',
                seeds: [],
                deltas: [],
                removedDocIds: [],
                expectedHeads: [
                    ['root', rootHeads],
                    ['branch_missing', getHeads(branch)],
                ],
            },
        });

        const response = posted[0]!;
        if (response.type !== 'compactStale') {
            throw new Error(`expected compactStale, got ${response.type}`);
        }
        expect(response.reason).toContain('replica holds 1 docs, caller holds 2');
    });

    it('keeps no replica from a load the caller did not mark as its own state', () => {
        const rootBytes = freshDoc('aaaaaaaaaaaaaaaa', (doc) => {
            doc.foreign = true;
        });
        onmessage!({ data: { id: 2, type: 'loadBundle', bundle: [['root', rootBytes]] } });
        posted.length = 0;

        onmessage!({
            data: {
                id: 24,
                type: 'compactShadow',
                seeds: [],
                deltas: [['root', new Uint8Array()]],
                removedDocIds: [],
                expectedHeads: [['root', getHeads(load<AnyDoc>(rootBytes))]],
            },
        });

        const response = posted[0]!;
        if (response.type !== 'compactStale') {
            throw new Error(`expected compactStale, got ${response.type}`);
        }
        expect(response.reason).toContain('no replica for root');
    });
});
