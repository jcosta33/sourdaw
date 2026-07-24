import { change, init, load, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

type WorkerResponse = LoadedResponse | MergedResponse | ErrorResponse;

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
    let onmessage: ((event: { data: unknown }) => void) | null;

    beforeEach(async () => {
        posted = [];
        const postMessage = vi.fn((message: unknown) => {
            posted.push(message as WorkerResponse);
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
});
