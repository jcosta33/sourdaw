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

import { type CrdtDocumentSnapshot } from '../models/CrdtDocumentSnapshot';
import { type DocId, type DocumentBundle, type MergeResult, DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';

import { compareIncrementalKeys } from './crdtPersistence/compareIncrementalKeys';

type AnyDoc = Record<string, unknown>;

type DecodedBundle = {
    documents: Map<DocId, Doc<AnyDoc>>;
    rootId: DocId;
};

type MergeBundleOptions = {
    shouldCommit?: () => boolean;
};

function createMissingRootError(): Error {
    return new Error('[AutomergeRepository] Non-empty bundle is missing the exact root document');
}

function createDocumentIdentityChangedError(): Error {
    return new Error('[AutomergeRepository] Document identity changed during merge; retry from fresh state');
}

function createRepositoryChangedDuringLoadError(): Error {
    return new Error('[AutomergeRepository] Repository changed during load; retry from fresh state');
}

function createSnapshotTransactionOverlapError(id: DocId): Error {
    return new Error(`[AutomergeRepository] Unowned write to ${id} overlaps the active snapshot transaction`);
}

// ── CRDT Worker ───────────────────────────────────────────────────────────────
// Heavy Automerge WASM ops (load + loadIncremental loops, merge) run in a
// background Worker so the main thread stays responsive during project open
// and collaboration patch ingestion.

type WorkerResponse =
    | { id: number; type: 'loaded'; compacted: [string, Uint8Array][]; rootId: string }
    | { id: number; type: 'merged'; compacted: [string, Uint8Array][]; mergedDocIds: string[]; newDocIds: string[] }
    | { id: number; type: 'error'; message: string };

type PendingWorkerRequest = {
    resolve: (response: WorkerResponse) => void;
    reject: (reason: Error) => void;
};

type CrdtWorkerInstance = {
    worker: Worker;
    pending: Map<number, PendingWorkerRequest>;
    failed: boolean;
    handleMessage: (event: MessageEvent) => void;
    handleFatalError: (event: ErrorEvent | MessageEvent) => void;
};

// §135.3 — Worker + next-id coalesced into a single holder.
const crdtWorkerState: { instance: CrdtWorkerInstance | null; nextId: number } = {
    instance: null,
    nextId: 0,
};

function failCrdtWorker(instance: CrdtWorkerInstance, error: Error): void {
    if (instance.failed) {
        return;
    }

    instance.failed = true;
    if (crdtWorkerState.instance === instance) {
        crdtWorkerState.instance = null;
    }

    instance.worker.removeEventListener('message', instance.handleMessage);
    instance.worker.removeEventListener('error', instance.handleFatalError);
    instance.worker.removeEventListener('messageerror', instance.handleFatalError);
    try {
        instance.worker.terminate();
    } catch (terminationError) {
        logger.warn('[AutomergeRepository] Failed to terminate crashed CRDT worker:', terminationError);
    }

    const pending = Array.from(instance.pending.values());
    instance.pending.clear();
    for (const request of pending) {
        request.reject(error);
    }
}

function createCrdtWorkerInstance(): CrdtWorkerInstance {
    const worker = new Worker(new URL('../workers/crdtWorker.ts', import.meta.url), { type: 'module' });
    let instance: CrdtWorkerInstance;

    function handleMessage(event: MessageEvent): void {
        if (instance.failed) {
            return;
        }

        const data = event.data as WorkerResponse;
        const request = instance.pending.get(data.id);
        if (!request) {
            return;
        }

        instance.pending.delete(data.id);
        if (data.type === 'error') {
            request.reject(new Error(data.message));
        } else {
            request.resolve(data);
        }
    }
    function handleFatalError(event: ErrorEvent | MessageEvent): void {
        const message = event instanceof ErrorEvent ? event.message : 'crdt worker postMessage failed';
        failCrdtWorker(instance, new Error(`crdtWorker crashed: ${message}`));
    }

    instance = {
        worker,
        pending: new Map(),
        failed: false,
        handleMessage,
        handleFatalError,
    };
    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleFatalError);
    worker.addEventListener('messageerror', handleFatalError);
    return instance;
}

function getCrdtWorkerInstance(): CrdtWorkerInstance {
    if (!crdtWorkerState.instance) {
        crdtWorkerState.instance = createCrdtWorkerInstance();
    }
    return crdtWorkerState.instance;
}

function invokeWorker(msg: Record<string, unknown>): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
        let instance: CrdtWorkerInstance;
        try {
            instance = getCrdtWorkerInstance();
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
        }

        const id = crdtWorkerState.nextId++;
        instance.pending.set(id, { resolve, reject });
        try {
            instance.worker.postMessage({ ...msg, id });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failCrdtWorker(instance, new Error(`crdtWorker postMessage failed: ${message}`));
        }
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
 * Active snapshot transaction state. A mutation participates only when it
 * carries this transaction's exact handle; concurrent unowned mutations are
 * never inferred from timing. Automerge v3 mutates WASM-backed docs in place,
 * so present bytes are captured before the mutation lands.
 */
type SnapshotTransaction = {
    /** Unforgeable-by-identity handle passed only to owned mutation calls. */
    readonly handle: object;
    /** Docs dirtied during the transaction, in first-touch order. */
    readonly dirtied: Set<DocId>;
    /** Pre-mutation membership/content, captured lazily on first touch. */
    readonly before: CrdtDocumentSnapshot;
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
    private mutationEpoch = 0;
    private documentIdentityEpoch = 0;
    private changeListeners = new Set<ChangeListener>();
    /** Used only to validate explicit transaction-handle identity. */
    private activeTransaction: SnapshotTransaction | null = null;
    /**
     * Tail of the serial transaction queue. `transactSnapshot` chains onto this
     * so two racing callers never share capture state; the second waits for the
     * first to finish before receiving its own handle.
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
        this.markDocumentIdentityMutation();

        return this.rootId;
    }

    /**
     * Create a new child document and register it.
     * Returns the DocId.
     */
    createChildDoc(docId: DocId, snapshotTransaction?: object): DocId {
        this.captureBeforeMutation(docId, snapshotTransaction);
        const doc = init<AnyDoc>();
        this.docs.set(docId, doc);
        this.markDocumentIdentityMutation();
        return docId;
    }

    /** Insert or replace a document (used by branching). */
    insertDoc(docId: DocId, doc: Doc<unknown>, snapshotTransaction?: object): void {
        this.captureBeforeMutation(docId, snapshotTransaction);
        this.docs.set(docId, doc as Doc<AnyDoc>);
        this.markDocumentIdentityMutation();
    }

    /**
     * Apply a mutation to a document.
     * This is the primary mutation entry point — all CRDT writes go through here.
     *
     * @param message - Optional semantic message attached to the Automerge change.
     *   Used for history inspection (`getHistory()` returns this in `DecodedChange.message`).
     */
    changeDoc<TDoc = AnyDoc>(
        id: DocId,
        changeFn: ChangeFn<TDoc>,
        message?: string,
        snapshotTransaction?: object
    ): void {
        const doc = this.docs.get(id) as Doc<TDoc> | undefined;
        if (!doc) {
            throw new Error(`Document not found: ${id}`);
        }

        this.captureBeforeMutation(id, snapshotTransaction);
        const updated = message ? change(doc, { message }, changeFn) : change(doc, changeFn);
        this.docs.set(id, updated as Doc<AnyDoc>);
        this.markMutation();
        this.notifyListeners(id);
    }

    /**
     * Replace a document directly (used by sync protocol after receiveSyncMessage).
     * Notifies listeners so response sync messages can be generated.
     */
    replaceDoc(id: DocId, doc: Doc<unknown>, snapshotTransaction?: object): void {
        this.captureBeforeMutation(id, snapshotTransaction);
        this.docs.set(id, doc as Doc<AnyDoc>);
        this.markDocumentIdentityMutation();
        this.notifyListeners(id);
    }

    /**
     * Merge a remote document's binary state into a local document.
     * Used for sync and merge-on-open.
     */
    mergeRemoteDoc(id: DocId, binary: Uint8Array, snapshotTransaction?: object): void {
        const incoming = load<AnyDoc>(binary);
        const isNewDocument = !this.docs.has(id);

        this.captureBeforeMutation(id, snapshotTransaction);
        if (!isNewDocument) {
            const local = this.docs.get(id)!;
            const merged = merge(local, incoming);
            this.docs.set(id, merged);
        } else {
            this.docs.set(id, incoming);
        }

        if (isNewDocument) {
            this.markDocumentIdentityMutation();
        } else {
            this.markMutation();
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

    /** Capture one exact pre-mutation content/membership entry for an owned write. */
    private captureBeforeMutation(id: DocId, snapshotTransaction?: object): void {
        const txn = this.activeTransaction;
        if (!txn) {
            return;
        }
        if (snapshotTransaction !== txn.handle) {
            if (txn.dirtied.has(id)) {
                throw createSnapshotTransactionOverlapError(id);
            }
            return;
        }
        txn.dirtied.add(id);
        if (txn.before.has(id)) {
            return;
        }

        const current = this.docs.get(id);
        if (current) {
            txn.before.set(id, { state: 'present', bytes: save(clone(current)) });
        } else {
            txn.before.set(id, { state: 'absent' });
        }
    }

    /**
     * Run an async operation and capture before/after binary snapshots
     * ONLY for the documents that were modified.
     *
     * Transactions are serialised through an internal queue: a second call
     * waits for the first to finish before opening, so two racing callers never
     * interleave their dirtied sets nor capture each other's mutations.
     */
    transactSnapshot(
        fn: (transaction: object) => Promise<void>
    ): Promise<{ before: CrdtDocumentSnapshot; after: CrdtDocumentSnapshot }> {
        const run = this.transactionQueue.then(() => this.runTransaction(fn));
        // Keep the queue tail alive even if this transaction rejects, so a
        // failed transaction does not wedge every later one.
        this.transactionQueue = run.catch(() => undefined);
        return run;
    }

    waitForSnapshotTransaction(snapshotTransaction?: object): Promise<void> {
        if (snapshotTransaction !== undefined && snapshotTransaction === this.activeTransaction?.handle) {
            return Promise.resolve();
        }
        return this.transactionQueue.then(() => undefined);
    }

    private async runTransaction(
        fn: (transaction: object) => Promise<void>
    ): Promise<{ before: CrdtDocumentSnapshot; after: CrdtDocumentSnapshot }> {
        const txn: SnapshotTransaction = {
            handle: Object.freeze({}),
            dirtied: new Set<DocId>(),
            before: new Map(),
        };

        this.activeTransaction = txn;
        try {
            await fn(txn.handle);
        } finally {
            this.activeTransaction = null;
        }

        const snapshotAfter: CrdtDocumentSnapshot = new Map();

        for (const id of txn.dirtied) {
            const postDoc = this.docs.get(id);
            if (postDoc) {
                snapshotAfter.set(id, { state: 'present', bytes: save(postDoc) });
            } else {
                snapshotAfter.set(id, { state: 'absent' });
            }
        }

        return { before: txn.before, after: snapshotAfter };
    }

    /**
     * Restore exact content and membership from a transaction snapshot.
     * Unlike `loadAll`, this does NOT clear docs or handle IDB incremental chunks —
     * it replaces existing docs in-place and fires listeners exactly once.
     */
    restoreSnapshot(snapshot: CrdtDocumentSnapshot): void {
        const decoded = new Map<DocId, Doc<AnyDoc>>();
        for (const [id, entry] of snapshot) {
            if (entry.state === 'present') {
                decoded.set(id, load<AnyDoc>(entry.bytes));
            }
        }

        let changesMembership = false;
        let changesContent = false;
        for (const [id, entry] of snapshot) {
            if (entry.state === 'absent') {
                if (this.docs.delete(id)) {
                    changesMembership = true;
                }
                continue;
            }

            changesMembership ||= !this.docs.has(id);
            this.docs.set(id, decoded.get(id)!);
            changesContent = true;
        }
        if (changesMembership || changesContent) {
            if (changesMembership) {
                this.markDocumentIdentityMutation();
            } else {
                this.markMutation();
            }
            this.notifyListeners();
        }
    }

    /** Validate a bundle with the same decode path used by project loading. */
    async validateAll({ bundle }: { bundle: DocumentBundle }): Promise<boolean> {
        if (bundle.size === 0) {
            return false;
        }

        const { documents } = await this.decodeAll(bundle);
        if (!documents.has(DOC_PREFIX_ROOT)) {
            throw createMissingRootError();
        }

        return true;
    }

    /** Load all documents from a bundle, replacing current state. */
    async loadAll({
        bundle,
        shouldCommit,
    }: {
        bundle: DocumentBundle;
        shouldCommit?: () => boolean;
    }): Promise<boolean> {
        if (bundle.size === 0) {
            return false;
        }

        const initialMutationEpoch = this.mutationEpoch;
        const initialDocumentIdentityEpoch = this.documentIdentityEpoch;
        let decoded: DecodedBundle;
        try {
            decoded = await this.decodeAll(bundle);
        } catch (error) {
            // A superseding load owns the state now. Its canceled result must
            // stay benign even when the abandoned bundle cannot be decoded.
            if (shouldCommit?.() === false) {
                return false;
            }
            throw error;
        }

        if (shouldCommit?.() === false) {
            return false;
        }
        if (
            this.mutationEpoch !== initialMutationEpoch ||
            this.documentIdentityEpoch !== initialDocumentIdentityEpoch
        ) {
            throw createRepositoryChangedDuringLoadError();
        }

        const { documents, rootId } = decoded;

        if (!documents.has(DOC_PREFIX_ROOT)) {
            throw createMissingRootError();
        }

        this.docs = documents;
        this.rootId = rootId;
        this.markDocumentIdentityMutation();
        this.notifyListeners();
        return true;
    }

    /**
     * Decode a bundle without mutating the repository.
     *
     * Heavy WASM parsing (load + loadIncremental loops) runs in
     * crdtWorker.ts. The worker returns compacted binaries; main thread calls
     * load() once per doc (fast — no incremental chain to replay).
     */
    private async decodeAll(bundle: DocumentBundle): Promise<DecodedBundle> {
        let compacted: [string, Uint8Array][];
        let rootId: string;
        let documents: Map<DocId, Doc<AnyDoc>>;

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
            documents = new Map<DocId, Doc<AnyDoc>>();
            for (const [id, bytes] of compacted) {
                documents.set(id, load<AnyDoc>(bytes));
            }
        } catch (error) {
            // Worker unavailable — fall back to synchronous parsing on main thread.
            logger.warn('[AutomergeRepository] CRDT worker failed, falling back to synchronous load:', error);
            const parsed = this._parseAllSync(bundle);
            documents = parsed.documents;
            rootId = parsed.rootId;
        }

        return { documents, rootId };
    }

    /** Parse fallback for loadAll when the worker is unavailable. */
    private _parseAllSync(bundle: DocumentBundle): {
        documents: Map<DocId, Doc<AnyDoc>>;
        rootId: DocId;
    } {
        const baseDocs = new Map<DocId, Uint8Array>();
        const incrementals: Array<{ id: DocId; bytes: Uint8Array }> = [];
        const documents = new Map<DocId, Doc<AnyDoc>>();
        let rootId: DocId = DOC_PREFIX_ROOT;

        for (const [key, bytes] of bundle) {
            if (key.includes(':incremental:')) {
                incrementals.push({ id: key, bytes });
            } else {
                baseDocs.set(key, bytes);
            }
        }

        for (const [id, bytes] of baseDocs) {
            documents.set(id, load<AnyDoc>(bytes));
            // Match the root id exactly. `startsWith` also matched sibling ids
            // like `root-2`/`rootBackup`, so with several matches the
            // last-iterated one won and root assignment depended on Map
            // iteration order.
            if (id === DOC_PREFIX_ROOT) {
                rootId = id;
            }
        }

        incrementals.sort((alpha, b) => compareIncrementalKeys(alpha.id, b.id));

        for (const { id: key, bytes } of incrementals) {
            const docId = key.substring(0, key.indexOf(':incremental:'));
            const doc = documents.get(docId);
            if (!doc) {
                throw new Error(
                    `[AutomergeRepository] Incremental chunk ${key} references missing base document ${docId}`
                );
            }
            documents.set(docId, loadIncremental(doc, bytes));
        }

        for (const [id, doc] of documents) {
            documents.set(id, load(save(doc)));
        }

        return { documents, rootId };
    }

    /**
     * Merge an external bundle into current state.
     * Documents with matching IDs are merged; new documents are inserted.
     *
     * Heavy WASM parsing runs in crdtWorker.ts. The current in-memory docs are
     * serialised once (save — fast), sent to the worker alongside the
     * incoming bundle, then the worker returns merged compacted binaries.
     */
    async mergeBundle(bundle: DocumentBundle, { shouldCommit }: MergeBundleOptions = {}): Promise<MergeResult> {
        const initialDocumentIdentityEpoch = this.documentIdentityEpoch;
        const decodedIncoming = await this.decodeAll(bundle);
        if (shouldCommit?.() === false) {
            return { mergedDocIds: [], newDocIds: [] };
        }
        if (this.documentIdentityEpoch !== initialDocumentIdentityEpoch) {
            throw createDocumentIdentityChangedError();
        }
        const normalizedIncoming: DocumentBundle = new Map();
        for (const [id, doc] of decodedIncoming.documents) {
            normalizedIncoming.set(id, save(doc));
        }

        while (shouldCommit?.() !== false) {
            const current = this.saveAll();
            const capturedMutationEpoch = this.mutationEpoch;
            const capturedDocumentIdentityEpoch = this.documentIdentityEpoch;

            let compacted: [string, Uint8Array][];
            let mergedDocIds: string[];
            let newDocIds: string[];

            try {
                const response = await invokeWorker({
                    type: 'mergeBundle',
                    current: Array.from(current.entries()),
                    incoming: Array.from(normalizedIncoming.entries()),
                });
                if (response.type !== 'merged') {
                    throw new Error('Unexpected worker response type');
                }
                compacted = response.compacted;
                mergedDocIds = response.mergedDocIds;
                newDocIds = response.newDocIds;
            } catch (error) {
                logger.warn('[AutomergeRepository] CRDT worker failed, falling back to synchronous merge:', error);
                if (shouldCommit?.() === false) {
                    return { mergedDocIds: [], newDocIds: [] };
                }
                if (this.documentIdentityEpoch !== capturedDocumentIdentityEpoch) {
                    throw createDocumentIdentityChangedError();
                }
                return this._mergeBundleSync(normalizedIncoming);
            }

            if (shouldCommit?.() === false) {
                return { mergedDocIds: [], newDocIds: [] };
            }
            if (this.documentIdentityEpoch !== capturedDocumentIdentityEpoch) {
                throw createDocumentIdentityChangedError();
            }
            if (this.mutationEpoch !== capturedMutationEpoch) {
                continue;
            }
            for (const [id, bytes] of compacted) {
                this.docs.set(id, load<AnyDoc>(bytes));
            }

            if (newDocIds.length > 0) {
                this.markDocumentIdentityMutation();
            } else {
                this.markMutation();
            }
            this.notifyListeners();
            return { mergedDocIds, newDocIds };
        }

        return { mergedDocIds: [], newDocIds: [] };
    }

    /** Synchronous fallback for mergeBundle (used when worker is unavailable). */
    private _mergeBundleSync(bundle: DocumentBundle): MergeResult {
        const result: MergeResult = { mergedDocIds: [], newDocIds: [] };

        for (const [id, bytes] of bundle) {
            const incoming = load<AnyDoc>(bytes);
            const local = this.docs.get(id);
            if (local) {
                // Compact through a save→load round-trip, exactly as the worker
                // path does (crdtWorker.processMerge saves every doc; mergeBundle
                // then loads the compacted bytes — see line ~706). A bare
                // in-place merge keeps both operation histories live in WASM
                // memory and grows unbounded across repeated sync merges.
                this.docs.set(id, load<AnyDoc>(save(merge(local, incoming))));
                result.mergedDocIds.push(id);
            } else {
                this.docs.set(id, load<AnyDoc>(save(incoming)));
                result.newDocIds.push(id);
            }
        }

        if (bundle.size > 0) {
            if (result.newDocIds.length > 0) {
                this.markDocumentIdentityMutation();
            } else {
                this.markMutation();
            }
        }
        this.notifyListeners();
        return result;
    }

    /** Remove a document. */
    removeDoc(id: DocId, snapshotTransaction?: object): void {
        if (!this.docs.has(id)) {
            return;
        }
        this.captureBeforeMutation(id, snapshotTransaction);
        this.docs.delete(id);
        this.markDocumentIdentityMutation();
    }

    /** Clear all documents and listeners. */
    reset(): void {
        this.docs.clear();
        this.rootId = DOC_PREFIX_ROOT;
        this.markDocumentIdentityMutation();
        // Drop change listeners too: otherwise projection-bridge subscriptions
        // from a previous session keep firing on the next session's edits.
        this.changeListeners.clear();
    }

    private markMutation(): void {
        this.mutationEpoch += 1;
    }

    private markDocumentIdentityMutation(): void {
        this.documentIdentityEpoch += 1;
        this.markMutation();
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
