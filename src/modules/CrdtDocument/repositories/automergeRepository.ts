import {
    type Doc,
    type ChangeFn,
    type Heads,
    init,
    load,
    save,
    saveIncremental,
    loadIncremental,
    merge,
    change,
    getChanges,
    view,
    getHeads,
    clone,
} from '@automerge/automerge';

import { logger } from '#/infra/logger/appLogger';

import { type DocId, type DocumentBundle, type MergeResult, DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';

type AnyDoc = Record<string, unknown>;

// ── CRDT Worker ───────────────────────────────────────────────────────────────
// Heavy Automerge WASM ops (load + loadIncremental loops, merge) run in a
// background Worker so the main thread stays responsive during project open
// and collaboration patch ingestion.

// §135.3 — Worker + next-id coalesced into a single holder.
const crdtWorkerState: { worker: Worker | null; nextId: number } = {
    worker: null,
    nextId: 0,
};

function getCrdtWorker(): Worker {
    if (!crdtWorkerState.worker) {
        crdtWorkerState.worker = new Worker(new URL('../workers/crdtWorker.ts', import.meta.url), { type: 'module' });
    }
    return crdtWorkerState.worker;
}

type WorkerResponse =
    | { id: number; type: 'loaded'; compacted: [string, Uint8Array][]; rootId: string }
    | { id: number; type: 'merged'; compacted: [string, Uint8Array][]; mergedDocIds: string[]; newDocIds: string[] }
    | { id: number; type: 'error'; message: string };

function invokeWorker(msg: Record<string, unknown>): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
        const worker = getCrdtWorker();
        const id = crdtWorkerState.nextId++;
        function cleanup(): void {
            worker.removeEventListener('message', handler);
            worker.removeEventListener('error', errorHandler);
            worker.removeEventListener('messageerror', errorHandler);
        }
        function handler(event: MessageEvent): void {
            const data = event.data as WorkerResponse;
            if (data.id !== id) {
                return;
            }
            cleanup();
            if (data.type === 'error') {
                reject(new Error(data.message));
            } else {
                resolve(data);
            }
        }
        // §71.3: if the worker crashes or the message cannot be deserialised,
        // without these listeners the returned Promise would hang forever.
        function errorHandler(event: ErrorEvent | MessageEvent): void {
            cleanup();
            const msg = event instanceof ErrorEvent ? event.message : 'crdt worker postMessage failed';
            reject(new Error(`crdtWorker crashed: ${msg}`));
        }
        worker.addEventListener('message', handler);
        worker.addEventListener('error', errorHandler);
        worker.addEventListener('messageerror', errorHandler);
        worker.postMessage({ ...msg, id });
    });
}

/** Callback invoked after any document change for projection. */
/**
 * Change listener. The optional `docId` is a hint: when present, only that
 * document changed; when absent, the caller modified multiple documents
 * (bulk load / merge / snapshot) and the listener must re-sync everything.
 * Consumers use the hint to narrow per-doc work (§138.1).
 */
type ChangeListener = (docId?: DocId) => void;

/**
 * Active snapshot transaction state. While one is open, every mutation method
 * captures the pre-mutation clone of each doc it is about to replace — lazily,
 * the first time that doc is touched. Automerge v3 mutates the WASM-backed doc
 * in place (the pre-`change()` reference reads the *post*-change state, verified
 * empirically), so the "before" snapshot must be cloned *before* the mutation
 * lands, not read back from a retained reference afterwards.
 */
type SnapshotTransaction = {
    /** Docs dirtied during the transaction, in first-touch order. */
    readonly dirtied: Set<DocId>;
    /** Pre-mutation clones, captured lazily on first touch per doc. */
    readonly preDocs: Map<DocId, Doc<AnyDoc>>;
};

/**
 * Singleton repository managing all live Automerge documents for the current project.
 *
 * This is the central CRDT state holder. All mutations flow through `changeDoc()`,
 * which triggers the projection bridge to update existing stores.
 */
class AutomergeRepository {
    private docs = new Map<DocId, Doc<AnyDoc>>();
    private rootId: DocId = DOC_PREFIX_ROOT;
    private changeListeners = new Set<ChangeListener>();
    /** The currently-open snapshot transaction, or null when none is in flight. */
    private activeTransaction: SnapshotTransaction | null = null;
    /**
     * Tail of the serial transaction queue. `transactSnapshot` chains onto this
     * so two racing callers never share a `dirtied`/`preDocs` set — the second
     * waits for the first to finish before its own before-bundle is captured.
     */
    private transactionQueue: Promise<unknown> = Promise.resolve();
    // Automerge's actor ID must be a hex string with an even length; the
    // default shape it uses is a 16-byte (32-char) hex. `crypto.randomUUID()`
    // without hyphens gives us 32 hex chars for free and avoids allocating
    // (then discarding) a full Automerge document just to read its actor ID.
    private actorId: string = crypto.randomUUID().replaceAll('-', '');

    /** Get the root document ID. */
    getRootId(): DocId {
        return this.rootId;
    }

    /** Get the local actor ID. */
    getActorId(): string {
        return this.actorId;
    }

    /** Get a document by ID (read-only). */
    getDoc<TDoc = AnyDoc>(id: DocId): Doc<TDoc> | undefined {
        return this.docs.get(id) as Doc<TDoc> | undefined;
    }

    /** Check if a document exists. */
    hasDoc(id: DocId): boolean {
        return this.docs.has(id);
    }

    /** List all document IDs. */
    getDocIds(): DocId[] {
        return Array.from(this.docs.keys());
    }

    /** Subscribe to document changes (for the projection bridge). */
    onChange(listener: ChangeListener): () => void {
        this.changeListeners.add(listener);
        return () => {
            this.changeListeners.delete(listener);
        };
    }

    /** Create a new empty project with a root document. */
    createProject(_name: string): DocId {
        this.docs.clear();

        this.rootId = DOC_PREFIX_ROOT;
        this.docs.set(this.rootId, init<AnyDoc>());

        return this.rootId;
    }

    /**
     * Create a new child document and register it.
     * Returns the DocId.
     */
    createChildDoc(docId: DocId): DocId {
        const doc = init<AnyDoc>();
        this.docs.set(docId, doc);
        return docId;
    }

    /** Insert or replace a document (used by branching). */
    insertDoc(docId: DocId, doc: Doc<unknown>): void {
        this.docs.set(docId, doc as Doc<AnyDoc>);
    }

    /**
     * Apply a mutation to a document.
     * This is the primary mutation entry point — all CRDT writes go through here.
     *
     * @param message - Optional semantic message attached to the Automerge change.
     *   Used for history inspection (`getHistory()` returns this in `DecodedChange.message`).
     */
    changeDoc<TDoc = AnyDoc>(id: DocId, changeFn: ChangeFn<TDoc>, message?: string): void {
        const doc = this.docs.get(id) as Doc<TDoc> | undefined;
        if (!doc) {
            throw new Error(`Document not found: ${id}`);
        }

        this.captureBeforeMutation(id);
        const updated = message ? change(doc, { message }, changeFn) : change(doc, changeFn);
        this.docs.set(id, updated as Doc<AnyDoc>);
        this.notifyListeners(id);
    }

    /**
     * Replace a document directly (used by sync protocol after receiveSyncMessage).
     * Notifies listeners so response sync messages can be generated.
     */
    replaceDoc(id: DocId, doc: Doc<unknown>): void {
        this.captureBeforeMutation(id);
        this.docs.set(id, doc as Doc<AnyDoc>);
        this.notifyListeners(id);
    }

    /**
     * Merge a remote document's binary state into a local document.
     * Used for sync and merge-on-open.
     */
    mergeRemoteDoc(id: DocId, binary: Uint8Array): void {
        const incoming = load<AnyDoc>(binary);

        this.captureBeforeMutation(id);
        if (this.docs.has(id)) {
            const local = this.docs.get(id)!;
            const merged = merge(local, incoming);
            this.docs.set(id, merged);
        } else {
            this.docs.set(id, incoming);
        }

        this.notifyListeners(id);
    }

    /** Serialize a single document to binary (full snapshot). */
    saveDoc(id: DocId): Uint8Array | undefined {
        const doc = this.docs.get(id);
        if (!doc) {
            return undefined;
        }
        return save(doc);
    }

    /** Serialize only the changes since the last save/saveIncremental call. */
    saveDocIncremental(id: DocId): Uint8Array | undefined {
        const doc = this.docs.get(id);
        if (!doc) {
            return undefined;
        }
        return saveIncremental(doc);
    }

    /** Serialize all documents as a bundle. */
    saveAll(): DocumentBundle {
        const bundle: DocumentBundle = new Map();
        for (const [id, doc] of this.docs) {
            bundle.set(id, save(doc));
        }
        return bundle;
    }

    /**
     * Clone the pre-mutation state of `id` into the active transaction the
     * first time that doc is touched within the transaction. Called by every
     * mutation method *before* it replaces the doc, so the clone captures the
     * genuine "before" state (Automerge v3 mutates the doc in place — a
     * reference held from before `change()` reads the post-change state, so the
     * snapshot cannot be reconstructed after the fact). No-op outside a
     * transaction, and at most one clone per doc per transaction.
     */
    private captureBeforeMutation(id: DocId): void {
        const txn = this.activeTransaction;
        if (!txn) {
            return;
        }
        txn.dirtied.add(id);
        if (!txn.preDocs.has(id)) {
            const current = this.docs.get(id);
            if (current) {
                txn.preDocs.set(id, clone(current));
            }
        }
    }

    /**
     * Wait for any in-flight `requestAnimationFrame`-deferred work to drain.
     *
     * Store writes (`createAutomergeStorage.set`) update their in-memory cache
     * synchronously but defer the actual `changeDoc()` to the next animation
     * frame to coalesce burst updates. A `transactSnapshot` body that drives
     * such stores therefore returns before any CRDT mutation has landed. This
     * yields past the current frame's rAF queue (scheduling our own rAF after
     * the store's, then a macrotask) so those deferred writes — and the
     * `captureBeforeMutation` clones they trigger — complete before we read the
     * dirtied set. Matches the flush idiom already used in sendChatMessage.
     */
    private flushPendingFrameWrites(): Promise<void> {
        if (typeof requestAnimationFrame !== 'function') {
            // Non-DOM environment (e.g. worker/test without rAF): nothing to drain.
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => setTimeout(resolve, 0));
        });
    }

    /**
     * Run an async operation and capture before/after binary snapshots
     * ONLY for the documents that were modified.
     *
     * Transactions are serialised through an internal queue: a second call
     * waits for the first to finish before opening, so two racing callers never
     * interleave their dirtied sets nor capture each other's mutations.
     */
    transactSnapshot(fn: () => Promise<void>): Promise<{ before: DocumentBundle; after: DocumentBundle }> {
        const run = this.transactionQueue.then(() => this.runTransaction(fn));
        // Keep the queue tail alive even if this transaction rejects, so a
        // failed transaction does not wedge every later one.
        this.transactionQueue = run.catch(() => undefined);
        return run;
    }

    private async runTransaction(fn: () => Promise<void>): Promise<{ before: DocumentBundle; after: DocumentBundle }> {
        const txn: SnapshotTransaction = { dirtied: new Set<DocId>(), preDocs: new Map<DocId, Doc<AnyDoc>>() };

        this.activeTransaction = txn;
        try {
            await fn();
            // Drain rAF-deferred store writes so their mutations (and the
            // pre-mutation clones they trigger) land before we read `dirtied`.
            await this.flushPendingFrameWrites();
        } finally {
            this.activeTransaction = null;
        }

        const bundleBefore: DocumentBundle = new Map();
        const bundleAfter: DocumentBundle = new Map();

        for (const id of txn.dirtied) {
            const preDoc = txn.preDocs.get(id);
            if (preDoc) {
                bundleBefore.set(id, save(preDoc));
            }
            const postDoc = this.docs.get(id);
            if (postDoc) {
                bundleAfter.set(id, save(postDoc));
            }
        }

        return { before: bundleBefore, after: bundleAfter };
    }

    /**
     * Restore all in-memory documents from a binary snapshot bundle (e.g. for undo/redo).
     * Unlike `loadAll`, this does NOT clear docs or handle IDB incremental chunks —
     * it replaces existing docs in-place and fires listeners exactly once.
     */
    restoreSnapshot(bundle: DocumentBundle): void {
        for (const [id, bytes] of bundle) {
            this.captureBeforeMutation(id);
            this.docs.set(id, load<AnyDoc>(bytes));
        }
        this.notifyListeners();
    }

    /**
     * Load all documents from a bundle, replacing current state.
     *
     * Heavy WASM parsing (load + loadIncremental loops) runs in
     * crdtWorker.ts. The worker returns compacted binaries; main thread calls
     * load() once per doc (fast — no incremental chain to replay).
     */
    async loadAll(bundle: DocumentBundle): Promise<void> {
        this.docs.clear();

        let compacted: [string, Uint8Array][];
        let rootId: string;

        try {
            const response = await invokeWorker({
                type: 'loadBundle',
                bundle: Array.from(bundle.entries()),
            });
            if (response.type !== 'loaded') {
                throw new Error('Unexpected worker response type');
            }
            compacted = response.compacted;
            rootId = response.rootId;
        } catch (error) {
            // Worker unavailable — fall back to synchronous parsing on main thread.
            logger.warn('[AutomergeRepository] CRDT worker failed, falling back to synchronous load:', error);
            this._loadAllSync(bundle);
            return;
        }

        for (const [id, bytes] of compacted) {
            this.docs.set(id, load<AnyDoc>(bytes));
        }
        this.rootId = rootId;

        this.notifyListeners();
    }

    /** Synchronous fallback for loadAll (used when worker is unavailable). */
    private _loadAllSync(bundle: DocumentBundle): void {
        const baseDocs = new Map<DocId, Uint8Array>();
        const incrementals: Array<{ id: DocId; bytes: Uint8Array }> = [];

        for (const [key, bytes] of bundle) {
            if (key.includes(':incremental:')) {
                incrementals.push({ id: key, bytes });
            } else {
                baseDocs.set(key, bytes);
            }
        }

        for (const [id, bytes] of baseDocs) {
            this.docs.set(id, load<AnyDoc>(bytes));
            // Match the root id exactly. `startsWith` also matched sibling ids
            // like `root-2`/`rootBackup`, so with several matches the
            // last-iterated one won and root assignment depended on Map
            // iteration order.
            if (id === DOC_PREFIX_ROOT) {
                this.rootId = id;
            }
        }

        incrementals.sort((alpha, b) => {
            const timeA = parseInt(alpha.id.split(':').pop() ?? '0', 10);
            const timeB = parseInt(b.id.split(':').pop() ?? '0', 10);
            return timeA - timeB;
        });

        for (const { id: key, bytes } of incrementals) {
            const docId = key.substring(0, key.indexOf(':incremental:'));
            const doc = this.docs.get(docId);
            if (doc) {
                this.docs.set(docId, loadIncremental(doc, bytes));
            } else {
                logger.warn(`[AutomergeRepository] Found incremental chunk for missing doc: ${docId}`);
            }
        }

        for (const [id, doc] of this.docs) {
            this.docs.set(id, load(save(doc)));
        }

        this.notifyListeners();
    }

    /**
     * Merge an external bundle into current state.
     * Documents with matching IDs are merged; new documents are inserted.
     *
     * Heavy WASM parsing runs in crdtWorker.ts. The current in-memory docs are
     * serialised once (save — fast), sent to the worker alongside the
     * incoming bundle, then the worker returns merged compacted binaries.
     */
    async mergeBundle(bundle: DocumentBundle): Promise<MergeResult> {
        const current = this.saveAll();

        let compacted: [string, Uint8Array][];
        let mergedDocIds: string[];
        let newDocIds: string[];

        try {
            const response = await invokeWorker({
                type: 'mergeBundle',
                current: Array.from(current.entries()),
                incoming: Array.from(bundle.entries()),
            });
            if (response.type !== 'merged') {
                throw new Error('Unexpected worker response type');
            }
            compacted = response.compacted;
            mergedDocIds = response.mergedDocIds;
            newDocIds = response.newDocIds;
        } catch (error) {
            logger.warn('[AutomergeRepository] CRDT worker failed, falling back to synchronous merge:', error);
            return this._mergeBundleSync(bundle);
        }

        for (const [id, bytes] of compacted) {
            this.docs.set(id, load<AnyDoc>(bytes));
        }

        this.notifyListeners();
        return { mergedDocIds, newDocIds };
    }

    /** Synchronous fallback for mergeBundle (used when worker is unavailable). */
    private _mergeBundleSync(bundle: DocumentBundle): MergeResult {
        const result: MergeResult = { mergedDocIds: [], newDocIds: [] };

        for (const [id, bytes] of bundle) {
            const incoming = load<AnyDoc>(bytes);
            const local = this.docs.get(id);
            if (local) {
                this.docs.set(id, merge(local, incoming));
                result.mergedDocIds.push(id);
            } else {
                this.docs.set(id, incoming);
                result.newDocIds.push(id);
            }
        }

        this.notifyListeners();
        return result;
    }

    /** Remove a document. */
    removeDoc(id: DocId): void {
        this.docs.delete(id);
    }

    /** Clear all documents and listeners. */
    reset(): void {
        this.docs.clear();
        this.rootId = DOC_PREFIX_ROOT;
        // Drop change listeners too: otherwise projection-bridge subscriptions
        // from a previous session keep firing on the next session's edits.
        this.changeListeners.clear();
    }

    /** Get the incremental changes since a given set of heads. */
    getChanges(id: DocId, heads: Heads): Uint8Array[] {
        const doc = this.docs.get(id);
        if (!doc) {
            return [];
        }
        return getChanges(view(doc, heads), doc);
    }

    /** Get the current heads of a document (for sync protocol). */
    getHeads(id: DocId): Heads | undefined {
        const doc = this.docs.get(id);
        if (!doc) {
            return undefined;
        }
        return getHeads(doc);
    }

    private notifyListeners(docId?: DocId): void {
        for (const listener of this.changeListeners) {
            try {
                listener(docId);
            } catch (error) {
                logger.warn('[AutomergeRepository] Listener error:', error);
            }
        }
    }
}

/** Singleton instance. */
export const automergeRepository = new AutomergeRepository();
