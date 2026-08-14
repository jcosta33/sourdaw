import { change, clone, getConflicts, type Doc } from '@automerge/automerge';

import { logger } from '#/infra/logger/appLogger';

import { reconcileCrdtSlot, type CrdtEntityIdentityByField } from './reconcileCrdtSlot';
import { type StorageAdapter } from './types';

type AutomergeStorageDocId = string;

type AutomergeStorageReadableDoc = {
    readonly [key: string]: unknown;
};

type AutomergeStorageMutableDoc = {
    [key: string]: unknown;
};

type AutomergeStoragePreviewContext = {
    readonly documents: Map<AutomergeStorageDocId, Doc<AutomergeStorageMutableDoc>>;
    readonly values: Map<object, unknown>;
    released: boolean;
};

export type AutomergeStoragePreview = {
    getDocument(docId: string): Readonly<Record<string, unknown>> | undefined;
    release(): void;
    scope<Result>(callback: () => Result): Result;
};

type AutomergeStorageMutationInput = {
    docId: AutomergeStorageDocId;
    /** The document slot this mutation writes. Wire format — never renamed. */
    key: string;
    changeFn: (doc: AutomergeStorageMutableDoc) => void;
    message?: string;
    snapshotTransaction?: object;
};

/**
 * One coalesced document write. `changedKeys` names every slot the change
 * touches so the projection bridge can re-project just those slots instead of
 * every root store (audit CC-1).
 */
type AutomergeStoragePortMutationInput = {
    docId: AutomergeStorageDocId;
    changedKeys: readonly string[];
    changeFn: (doc: AutomergeStorageMutableDoc) => void;
    message?: string;
    snapshotTransaction?: object;
};

type AutomergeStoragePort = {
    getSemanticMessage(): string | undefined;
    hasDoc(docId: AutomergeStorageDocId): boolean;
    getDoc(docId: AutomergeStorageDocId): AutomergeStorageReadableDoc | undefined;
    /**
     * Current document version identity. When it has not moved since the last
     * hydrate the slot cannot have changed, so hydrate can skip its
     * `JSON.stringify` compare entirely (audit CC-1).
     */
    getDocHeads?(docId: AutomergeStorageDocId): readonly string[] | undefined;
    /**
     * Apply `changeFn` to the document at `docId`.
     *
     * **Durability contract the flush path relies on.** `changeFn` must run
     * inside an all-or-nothing document transaction: if it throws, the document
     * is left exactly as it was. The only production port
     * (`registerCrdtStorageRuntime` → `automergeRepository.changeDoc`) satisfies
     * this because Automerge's `change()` rolls its transaction back and
     * rethrows when the callback throws, and the repository publishes the
     * returned document only once `change()` has returned.
     *
     * A throw raised *after* `changeFn` returns is therefore the one case where
     * durability is genuinely unknown — by then the new document is published
     * and whatever failed next (listener notification, sync fan-out) ran on
     * committed truth. `flushMatchingAutomergeStorageWrites` treats exactly that
     * case as committed.
     */
    mutateDoc(input: AutomergeStoragePortMutationInput): void;
    waitForSnapshotTransaction?(snapshotTransaction?: object): Promise<void>;
};

type AutomergeStorageOptions<TData> = {
    /** Optional function to strip ephemeral fields before writing to CRDT. */
    toCrdt?: (value: TData) => Partial<TData>;
    /** Optional function to normalize incoming data on hydrate (e.g. fill missing fields from older schemas). */
    fromCrdt?: (value: TData) => TData;
    /** Replacement projection value when the active document has no slot for this store. */
    hydrateMissing?: () => TData;
    /** Deterministically reconcile concurrent whole-slot values exposed by Automerge. */
    resolveConflicts?: (values: readonly TData[]) => TData;
    /** Reconcile raw concurrent CRDT values before domain decoding when tombstones or schema metadata matter. */
    resolveCrdtConflicts?: (values: readonly unknown[]) => TData;
    /**
     * Mutate a CRDT slot in place so domain entities retain causal identity.
     * Overrides the default in-place reconciliation entirely; a store supplies
     * one only when its slot carries a schema the generic reconciler cannot
     * read, such as an explicit tombstone encoding.
     */
    mutateCrdt?: (input: {
        doc: AutomergeStorageMutableDoc;
        key: string;
        /** The value this write was derived from, already narrowed by `toCrdt`. */
        baseValue: Partial<TData> | null;
        value: TData;
    }) => void;
    /**
     * Identity overrides for collections whose rows carry no `id`, keyed by the
     * field name holding the collection. Without an entry a collection of
     * id-less rows is written as one opaque value.
     */
    crdtEntityIdentity?: CrdtEntityIdentityByField;
    /** Rebase a deferred local value over a newer hydrated value. */
    rebasePending?: (input: {
        baseValue: TData | null;
        pendingValue: TData | null;
        hydratedValue: TData;
    }) => TData | null;
};

type AutomergeStorageWriteContext = {
    readonly commitOwner: object;
    readonly scoped: boolean;
    readonly snapshotTransaction: object | undefined;
};

/**
 * Why a pending write cannot be committed right now. Audit CC-5 — `prepare()`
 * used to answer this with a bare null, which conflated two opposite
 * situations and forced the single `didDiscard` terminal to guess:
 *
 * - `abandon` — the value is not truth. Either a newer committed value already
 *   superseded it, or the document it targets is gone. The cache must fall
 *   back to the last committed value, exactly like an abort.
 * - `defer` — there is no document authority yet (the CRDT port is not wired).
 *   Nothing has ever committed, so the optimistic value is the only state the
 *   app has; drop the write but keep the value visible.
 */
type PendingWritePreparation =
    | { readonly status: 'ready'; readonly mutation: AutomergeStorageMutationInput }
    | { readonly status: 'abandon' }
    | { readonly status: 'defer' };

type PendingAutomergeStorageWrite = {
    readonly abort: () => void;
    readonly commitOwner: object;
    readonly didCommit: () => void;
    readonly didDefer: () => void;
    readonly docId: AutomergeStorageDocId;
    readonly snapshotTransaction: object | undefined;
    readonly prepare: () => PendingWritePreparation;
};

type ActiveAutomergeStorageTransaction = {
    readonly commitOwner: object;
    readonly snapshotTransaction: object | undefined;
};

/**
 * Re-enters an open transaction for the synchronous duration of `callback`.
 *
 * Audit CC-10 — the ambient transaction is installed only while the
 * transaction callback runs synchronously, so an async handler loses it at its
 * first `await` and every later write commits unscoped. Browsers have no async
 * context propagation, and widening the ambient across awaits would also
 * capture writes made by unrelated code running in that window (dozens of UI
 * call sites dispatch actions without awaiting them), so the re-entry is
 * explicit rather than implicit.
 */
type AutomergeStorageTransactionScope = <Result>(callback: () => Result) => Result;

type AutomergeStorageDocumentValidator = (doc: AutomergeStorageReadableDoc) => string | null;

type AutomergeStorageTransactionControl = {
    readonly scope: AutomergeStorageTransactionScope;
    abort(): void;
    commit(): void;
    validateCommit(validator: () => string | null): void;
    validateDocument(docId: AutomergeStorageDocId, validator: AutomergeStorageDocumentValidator): void;
};

type AutomergeStorageTransactionOutcome<Result> =
    | { readonly status: 'returned'; readonly value: Result }
    | {
          readonly status: 'threw';
          readonly error: unknown;
      };

type AutomergeStorageTransactionResult<Result> = AutomergeStorageTransactionControl &
    AutomergeStorageTransactionOutcome<Result>;

class AutomergeStorageFlushError extends Error {
    readonly committedDocumentCount: number;
    readonly failure: unknown;

    constructor(failure: unknown, committedDocumentCount: number) {
        super(failure instanceof Error ? failure.message : 'Failed to flush an Automerge storage write', {
            cause: failure,
        });
        this.name = 'AutomergeStorageFlushError';
        this.committedDocumentCount = committedDocumentCount;
        this.failure = failure;
    }
}

export class AutomergeStorageTransactionCommittedError extends Error {
    constructor(cause: unknown) {
        super('Automerge storage transaction committed before a later document failed', { cause });
        this.name = 'AutomergeStorageTransactionCommittedError';
    }
}

export class AutomergeStorageTransactionValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AutomergeStorageTransactionValidationError';
    }
}

let automergeStoragePort: AutomergeStoragePort | null = null;
const pendingAutomergeStorageWrites = new Set<PendingAutomergeStorageWrite>();
const openAutomergeStorageCommitOwners = new Set<object>();
let activeAutomergeStorageTransaction: ActiveAutomergeStorageTransaction | undefined;
let activeAutomergeStoragePreview: AutomergeStoragePreviewContext | null = null;
const inboundSanitizersBySlot = new Map<string, (value: unknown) => unknown>();

function getInboundSanitizerKey(docId: string, key: string): string {
    return `${docId}\u0000${key}`;
}

function projectionPreservesRawValue(raw: unknown, projected: unknown): boolean {
    if (Object.is(raw, projected)) {
        return true;
    }
    if (Array.isArray(raw)) {
        return (
            Array.isArray(projected) &&
            projected.length >= raw.length &&
            raw.every((item, index) => projectionPreservesRawValue(item, projected[index]))
        );
    }
    if (typeof raw !== 'object' || raw === null || typeof projected !== 'object' || projected === null) {
        return false;
    }
    const projectedRecord = projected as Readonly<Record<string, unknown>>;
    return Object.entries(raw).every(
        ([key, value]) =>
            Object.hasOwn(projectedRecord, key) && projectionPreservesRawValue(value, projectedRecord[key])
    );
}

export function findAutomergeStorageRawProjectionLosses(input: {
    docId: string;
    document: Readonly<Record<string, unknown>>;
}): string[] {
    const losses: string[] = [];
    for (const [slot, rawValue] of Object.entries(input.document)) {
        const sanitize = inboundSanitizersBySlot.get(getInboundSanitizerKey(input.docId, slot));
        if (!sanitize) {
            continue;
        }
        try {
            if (!projectionPreservesRawValue(rawValue, sanitize(rawValue))) {
                losses.push(slot);
            }
        } catch {
            losses.push(slot);
        }
    }
    return losses.toSorted();
}

function clonePreviewValue<Value>(value: Value): Value {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as Value);
}

export function createAutomergeStoragePreview(
    sourceDocuments: ReadonlyMap<string, Doc<AutomergeStorageMutableDoc>>
): AutomergeStoragePreview {
    const context: AutomergeStoragePreviewContext = {
        documents: new Map([...sourceDocuments].map(([docId, document]) => [docId, clone(document)])),
        values: new Map(),
        released: false,
    };

    return {
        getDocument(docId): Readonly<Record<string, unknown>> | undefined {
            if (context.released) {
                return undefined;
            }
            const document = context.documents.get(docId);
            return document ? clonePreviewValue(document) : undefined;
        },
        release(): void {
            context.released = true;
            context.documents.clear();
            context.values.clear();
        },
        scope<Result>(callback: () => Result): Result {
            if (context.released) {
                throw new Error('Automerge storage preview has been released');
            }
            if (activeAutomergeStoragePreview && activeAutomergeStoragePreview !== context) {
                throw new Error('Another Automerge storage preview is already active');
            }
            const previous = activeAutomergeStoragePreview;
            activeAutomergeStoragePreview = context;
            try {
                return callback();
            } finally {
                activeAutomergeStoragePreview = previous;
            }
        },
    };
}

/**
 * How a coalesced document write ended, and what its failure says about the
 * document.
 *
 * The boundary is the moment the coalesced `changeFn` returns — see the
 * durability contract on `AutomergeStoragePort.mutateDoc`:
 *
 * - `rolled-back` — the mutation never reached the document. Either the port
 *   threw before it ran `changeFn` at all, or `changeFn` threw and the change
 *   transaction was rolled back. A slot validator that refuses an unsupported
 *   schema lands here, and its own error is what the caller must see.
 * - `ambiguous` — `changeFn` completed and something after it threw. The change
 *   is published; the write is durable even though the flush failed.
 */
type AutomergeStorageCommitOutcome =
    | { readonly status: 'committed' }
    | { readonly status: 'rolled-back'; readonly error: unknown }
    | { readonly status: 'ambiguous'; readonly error: unknown };

/** One Automerge change is the atomic commit boundary for keys sharing a document and owner. */
function commitAutomergeStorageMutations(
    mutations: readonly AutomergeStorageMutationInput[],
    validateDocument?: AutomergeStorageDocumentValidator
): AutomergeStorageCommitOutcome {
    const firstMutation = mutations[0];
    if (!firstMutation) {
        return { status: 'committed' };
    }

    const port = getAutomergeStoragePort();
    if (!port) {
        return { status: 'committed' };
    }

    const message = mutations.find((mutation) => mutation.message !== undefined)?.message;
    const changedKeys = [...new Set(mutations.map((mutation) => mutation.key))];
    // Written by the callback `mutateDoc` invokes synchronously, and read after
    // it throws. It is a property rather than a plain `let` because TypeScript's
    // control-flow analysis does not model the write through the callback and
    // narrows a local to `false` for the whole catch below.
    const application = { appliedChangeFn: false };
    try {
        port.mutateDoc({
            docId: firstMutation.docId,
            changedKeys,
            changeFn: (doc) => {
                for (const mutation of mutations) {
                    mutation.changeFn(doc);
                }
                const validationFailure = validateDocument?.(doc) ?? null;
                if (validationFailure) {
                    throw new AutomergeStorageTransactionValidationError(validationFailure);
                }
                application.appliedChangeFn = true;
            },
            message,
            snapshotTransaction: firstMutation.snapshotTransaction,
        });
    } catch (error) {
        if (application.appliedChangeFn) {
            return { status: 'ambiguous', error };
        }
        return { status: 'rolled-back', error };
    }

    return { status: 'committed' };
}

/**
 * Captures the transaction that is active right now, returning a function that
 * re-enters it later.
 *
 * Audit CC-10 — an `async` action handler runs inside the action's transaction
 * only until its first `await`; after that the ambient scope is gone and every
 * store write it makes commits on its own, outside the action's atomic commit,
 * and survives an abort that should have discarded it.
 *
 * A handler that writes after an `await` calls this **synchronously, before
 * that await**, and wraps the later writes in the returned function:
 *
 * ```ts
 * execute: async (action) => {
 *     const scope = captureAutomergeStorageTransactionScope();
 *     const rendered = await render(action);
 *     scope(() => { trackStore.set(rendered); });
 * }
 * ```
 *
 * Capture is explicit rather than implicit because browsers have no async
 * context propagation: keeping the ambient transaction installed across an
 * `await` would also capture writes made by unrelated code running in that
 * window, and this app dispatches many actions without awaiting them.
 *
 * With no transaction active the returned function simply runs the callback,
 * which is the correct unscoped behaviour for a handler invoked outside
 * `executeAppAction`.
 *
 * The returned function takes a **synchronous** callback. It restores the
 * previous ambient transaction in a `finally` that runs as soon as the
 * callback's synchronous portion returns, so `scope(async () => …)` un-scopes
 * at that callback's own first `await` and silently reproduces the bug this
 * exists to fix. Await outside, write inside; two writes separated by an
 * `await` need two calls. Capturing after an `await` degrades the same silent
 * way, since there is no longer a transaction to capture.
 */
export function captureAutomergeStorageTransactionScope(): AutomergeStorageTransactionScope {
    const capturedTransaction = activeAutomergeStorageTransaction;
    if (!capturedTransaction) {
        return (callback) => callback();
    }

    return (callback) => {
        if (!openAutomergeStorageCommitOwners.has(capturedTransaction.commitOwner)) {
            // The commit owner is closed: a write attached to it now would
            // never flush. Fail loudly rather than swallow it.
            throw new Error('Automerge storage transaction has already settled');
        }
        const previous = activeAutomergeStorageTransaction;
        activeAutomergeStorageTransaction = capturedTransaction;
        try {
            return callback();
        } finally {
            activeAutomergeStorageTransaction = previous;
        }
    };
}

/**
 * Scope one action write path to an opaque snapshot transaction.
 *
 * `callback` receives a `scope` that re-enters this transaction, equivalent to
 * `captureAutomergeStorageTransactionScope()` called inside it.
 */
export function runWithAutomergeStorageTransaction<Result>(
    snapshotTransaction: object | undefined,
    callback: (scope: AutomergeStorageTransactionScope) => Result
): AutomergeStorageTransactionResult<Result> {
    const previousTransaction = activeAutomergeStorageTransaction;
    const transaction: ActiveAutomergeStorageTransaction = {
        commitOwner: Object.freeze({}),
        snapshotTransaction,
    };
    activeAutomergeStorageTransaction = transaction;
    openAutomergeStorageCommitOwners.add(transaction.commitOwner);
    let terminalState: 'open' | 'committed' | 'aborted' = 'open';
    const commitValidators: Array<() => string | null> = [];
    const documentValidators = new Map<AutomergeStorageDocId, AutomergeStorageDocumentValidator>();
    let outcome: AutomergeStorageTransactionOutcome<Result>;

    const scope: AutomergeStorageTransactionScope = (scopedCallback) => {
        if (terminalState !== 'open') {
            // The commit owner is closed: a write attached to it now would
            // never flush. Fail loudly rather than swallow it.
            throw new Error(`Automerge storage transaction has already settled (${terminalState})`);
        }
        const previous = activeAutomergeStorageTransaction;
        activeAutomergeStorageTransaction = transaction;
        try {
            return scopedCallback();
        } finally {
            activeAutomergeStorageTransaction = previous;
        }
    };

    try {
        outcome = { status: 'returned', value: callback(scope) };
    } catch (error) {
        outcome = { status: 'threw', error };
    } finally {
        activeAutomergeStorageTransaction = previousTransaction;
    }

    const control: AutomergeStorageTransactionControl = {
        scope,
        abort(): void {
            if (terminalState !== 'open') {
                return;
            }
            terminalState = 'aborted';
            openAutomergeStorageCommitOwners.delete(transaction.commitOwner);
            for (const pending of [...pendingAutomergeStorageWrites]) {
                if (
                    pending.commitOwner === transaction.commitOwner &&
                    pending.snapshotTransaction === transaction.snapshotTransaction
                ) {
                    pending.abort();
                }
            }
        },
        commit(): void {
            if (terminalState !== 'open') {
                return;
            }
            for (const validateCommit of commitValidators) {
                const validationFailure = validateCommit();
                if (validationFailure) {
                    throw new AutomergeStorageTransactionValidationError(validationFailure);
                }
            }
            openAutomergeStorageCommitOwners.delete(transaction.commitOwner);
            try {
                flushMatchingAutomergeStorageWrites(
                    (pending) =>
                        pending.commitOwner === transaction.commitOwner &&
                        pending.snapshotTransaction === transaction.snapshotTransaction,
                    documentValidators
                );
            } catch (error) {
                if (error instanceof AutomergeStorageFlushError && error.committedDocumentCount > 0) {
                    terminalState = 'committed';
                    for (const pending of [...pendingAutomergeStorageWrites]) {
                        if (
                            pending.commitOwner === transaction.commitOwner &&
                            pending.snapshotTransaction === transaction.snapshotTransaction
                        ) {
                            pending.abort();
                        }
                    }
                    throw new AutomergeStorageTransactionCommittedError(error.failure);
                }

                openAutomergeStorageCommitOwners.add(transaction.commitOwner);
                throw error instanceof AutomergeStorageFlushError ? error.failure : error;
            }
            terminalState = 'committed';
        },
        validateCommit(validator): void {
            if (terminalState !== 'open') {
                throw new Error(`Automerge storage transaction has already settled (${terminalState})`);
            }
            commitValidators.push(validator);
        },
        validateDocument(docId, validator): void {
            if (terminalState !== 'open') {
                throw new Error(`Automerge storage transaction has already settled (${terminalState})`);
            }
            if (documentValidators.has(docId)) {
                throw new Error(`Automerge storage transaction already has a validator for document: ${docId}`);
            }
            documentValidators.set(docId, validator);
        },
    };

    return { ...outcome, ...control };
}

function flushMatchingAutomergeStorageWrites(
    matches: (pending: PendingAutomergeStorageWrite) => boolean,
    documentValidators: ReadonlyMap<AutomergeStorageDocId, AutomergeStorageDocumentValidator> = new Map()
): void {
    let firstError: unknown;
    let committedDocumentCount = 0;
    const validatedDocumentIds = new Set<AutomergeStorageDocId>();
    const groups = new Map<string, Map<object, PendingAutomergeStorageWrite[]>>();

    for (const pending of [...pendingAutomergeStorageWrites]) {
        if (!matches(pending)) {
            continue;
        }
        if (openAutomergeStorageCommitOwners.has(pending.commitOwner)) {
            continue;
        }

        let ownerGroups = groups.get(pending.docId);
        if (!ownerGroups) {
            ownerGroups = new Map();
            groups.set(pending.docId, ownerGroups);
        }

        const ownerWrites = ownerGroups.get(pending.commitOwner);
        if (ownerWrites) {
            ownerWrites.push(pending);
        } else {
            ownerGroups.set(pending.commitOwner, [pending]);
        }
    }

    for (const [docId, ownerGroups] of groups) {
        for (const writes of ownerGroups.values()) {
            const mutations: AutomergeStorageMutationInput[] = [];
            const abandonedWrites: PendingAutomergeStorageWrite[] = [];
            let preparationFailed = false;
            let preparationUnavailable = false;

            for (const write of writes) {
                try {
                    const preparation = write.prepare();
                    if (preparation.status === 'ready') {
                        mutations.push(preparation.mutation);
                        continue;
                    }
                    preparationUnavailable = true;
                    if (preparation.status === 'abandon') {
                        abandonedWrites.push(write);
                    }
                } catch (error) {
                    preparationFailed = true;
                    firstError ??= error;
                }
            }

            if (preparationFailed) {
                // Audit CC-7 — `prepare()` already cancelled each write's
                // animation frame, and nothing re-arms it. Leaving the group
                // pending kept it in the write set forever with a dead frame:
                // the owner slot stayed occupied, so every later set() reused
                // it without scheduling a flush and the adapter silently
                // stopped persisting. Abort instead — the value could not be
                // serialized, so it can never reach the document, and the
                // cache must fall back to the last committed value rather
                // than keep serving a write that will never land. The
                // collected error still propagates to the caller below.
                for (const write of writes) {
                    write.abort();
                }
                continue;
            }
            if (preparationUnavailable) {
                // The group is atomic, so one unpreparable write blocks all of
                // them. Each write still takes the terminal its own
                // preparation earned: an abandoned value is rolled back
                // (audit CC-5), while a write merely blocked by a sibling —
                // or waiting for the CRDT port — keeps its optimistic value.
                const abandoned = new Set(abandonedWrites);
                for (const write of writes) {
                    if (abandoned.has(write)) {
                        write.abort();
                        continue;
                    }
                    write.didDefer();
                }
                continue;
            }

            const outcome = commitAutomergeStorageMutations(mutations, documentValidators.get(docId));
            if (documentValidators.has(docId)) {
                validatedDocumentIds.add(docId);
            }
            if (outcome.status === 'rolled-back') {
                // Nothing reached the document, so this group did not commit
                // and must not make a later document's failure look like a
                // partial commit. A slot validator that refuses before writing
                // reaches the caller as its own error rather than as
                // "transaction committed", which would say the opposite of
                // what happened.
                firstError ??= outcome.error;
                continue;
            }

            // Both remaining outcomes moved the document.
            committedDocumentCount += 1;
            if (outcome.status === 'ambiguous') {
                // `changeFn` completed before the failure, so the change is
                // published and the durable terminal cannot be taken back —
                // even for the first document.
                firstError ??= outcome.error;
                continue;
            }

            for (const write of writes) {
                write.didCommit();
            }
        }
    }

    const port = getAutomergeStoragePort();
    for (const [docId, validateDocument] of documentValidators) {
        if (validatedDocumentIds.has(docId)) {
            continue;
        }
        const document = port?.getDoc(docId);
        const validationFailure = validateDocument(document ?? {});
        if (validationFailure) {
            firstError ??= new AutomergeStorageTransactionValidationError(validationFailure);
        }
    }

    if (firstError !== undefined) {
        throw new AutomergeStorageFlushError(firstError, committedDocumentCount);
    }
}

function flushAutomergeStorageWriteOwner(write: PendingAutomergeStorageWrite): void {
    flushMatchingAutomergeStorageWrites(
        (pending) =>
            pending.commitOwner === write.commitOwner && pending.snapshotTransaction === write.snapshotTransaction
    );
}

export function flushAutomergeStorageWrites(snapshotTransaction?: object): void {
    flushMatchingAutomergeStorageWrites(
        (pending) => snapshotTransaction === undefined || pending.snapshotTransaction === snapshotTransaction
    );
}

export function configureAutomergeStoragePort(port: AutomergeStoragePort | null): void {
    automergeStoragePort = port;
}

/**
 * Every live adapter, so an authority switch can drop the outgoing project's
 * caches. Without this the stores keep the previous project's values and the
 * first projection against the fresh document resurrects them (audit CC-2).
 */
const automergeStorageProjections = new Set<{
    docId: AutomergeStorageDocId;
    resetProjection: () => void;
}>();

/**
 * Drop the projected caches of every store backed by `docId` and restore each
 * one to its `hydrateMissing` default. Call this when the document authority is
 * replaced, before anything projects from the new document.
 */
export function resetAutomergeStorageProjections(docId: AutomergeStorageDocId): void {
    for (const projection of [...automergeStorageProjections]) {
        if (projection.docId === docId) {
            // Guarded per projection: a throw partway through used to leave an
            // arbitrary subset of stores still holding the outgoing project
            // while the rest had been reset — the stale-bleed this function
            // exists to prevent, applied to whichever projections happened to
            // come after the failing one. Callers also treat "this returned" as
            // "every projection is reset", so it must not exit early.
            try {
                projection.resetProjection();
            } catch (error) {
                logger.error(new Error('Automerge projection reset failed', { cause: error }));
            }
        }
    }
}

const getAutomergeStoragePort = (): AutomergeStoragePort | null => {
    return automergeStoragePort;
};

export function waitForAutomergeSnapshotTransaction(snapshotTransaction?: object): Promise<void> {
    return getAutomergeStoragePort()?.waitForSnapshotTransaction?.(snapshotTransaction) ?? Promise.resolve();
}

/**
 * A storage adapter that persists store state in an Automerge CRDT document.
 *
 * Each store gets a dedicated key within an Automerge document.
 * Writes go through the automergeRepository, which handles change tracking
 * and sync. Reads come from a fast in-memory cache.
 *
 * Use `toCrdt` to strip ephemeral fields that shouldn't be persisted or
 * synced (e.g. `isPlaying`, `playheadPosition` on the transport store).
 *
 * ## CRDT write batching
 *
 * `set()` updates the in-memory cache immediately (so the UI stays responsive).
 * The actual Automerge `changeDoc()` write is deferred to the next animation
 * frame via `requestAnimationFrame`. This collapses rapid burst updates (knob
 * sweeps, fader drags, clip moves) into a single CRDT mutation per frame.
 *
 * ## Automerge v3 constraints handled here
 *
 * Values read from an Automerge doc are Proxy objects. Automerge rejects
 * re-inserting a proxy into a `change()` call. It also rejects `undefined`
 * values. `toDocSafe()` strips both via a JSON round-trip.
 */
export const createAutomergeStorage = <TData>(
    docId: AutomergeStorageDocId,
    key: string,
    options?: AutomergeStorageOptions<TData>
): StorageAdapter<TData> => {
    const toCrdt = options?.toCrdt;
    const fromCrdt = options?.fromCrdt;
    const hydrateMissing = options?.hydrateMissing;
    const resolveConflicts = options?.resolveConflicts;
    const resolveCrdtConflicts = options?.resolveCrdtConflicts;
    const mutateCrdt = options?.mutateCrdt;
    const crdtEntityIdentity = options?.crdtEntityIdentity;
    const rebasePending = options?.rebasePending;
    type AdapterPendingWrite = {
        baseValue: TData | null;
        message: string | undefined;
        rafId: number | null;
        revision: number;
        scoped: boolean;
        value: TData | null;
        write: PendingAutomergeStorageWrite;
    };
    let cachedValue: TData | null = null;
    let committedCacheValue: TData | null = null;
    let committedCacheRevision = 0;
    const previewIdentity = Object.freeze({});

    const getPreviewValue = (context: AutomergeStoragePreviewContext): TData | null => {
        if (!context.values.has(previewIdentity)) {
            // Some domain decoders intentionally preserve ephemeral local fields by
            // reading their owning store. Seed that recursive read with the live
            // projection while the declared-head CRDT value is being decoded.
            context.values.set(previewIdentity, cachedValue);
            const document = context.documents.get(docId);
            const rawValue = document?.[key];
            let initialValue: TData | null = null;
            if (rawValue !== undefined) {
                let rawValues: readonly unknown[] = [rawValue];
                if (document && (resolveConflicts || resolveCrdtConflicts)) {
                    const conflicts = getConflicts(document, key);
                    if (conflicts) {
                        rawValues = Object.entries(conflicts)
                            .sort(([leftActor], [rightActor]) => leftActor.localeCompare(rightActor))
                            .map(([, conflictValue]) => conflictValue);
                    }
                }
                const clonedValues = clonePreviewValue(rawValues);
                const normalizedValues = fromCrdt
                    ? clonedValues.map((value) => fromCrdt(value as TData))
                    : (clonedValues as TData[]);
                const firstValue = normalizedValues[0];
                if (firstValue !== undefined) {
                    initialValue = firstValue;
                    if (resolveCrdtConflicts && clonedValues.length > 1) {
                        initialValue = resolveCrdtConflicts(clonedValues);
                    } else if (resolveConflicts && normalizedValues.length > 1) {
                        initialValue = resolveConflicts(normalizedValues);
                    }
                }
            } else if (hydrateMissing) {
                initialValue = clonePreviewValue(hydrateMissing());
            }
            context.values.set(previewIdentity, initialValue);
        }
        return context.values.get(previewIdentity) as TData | null;
    };

    const setPreviewValue = (context: AutomergeStoragePreviewContext, value: TData | null): void => {
        const document = context.documents.get(docId);
        const mutation = createMutation(value, getPreviewValue(context));
        if (!document || !mutation) {
            throw new Error(`Automerge storage preview document is unavailable: ${docId}`);
        }
        context.documents.set(
            docId,
            change(document, (draft) => {
                mutation.changeFn(draft);
            })
        );
        context.values.set(previewIdentity, clonePreviewValue(value));
    };

    // Slot absence is still authoritative once hydrate has observed a document.
    // Keep that fact separate from revision counters, which only advance for a
    // present slot, a local commit, or an explicit projection reset.
    let hasObservedDocumentAuthority = false;
    /**
     * Set-time high-water mark of the newest committed value. Unlike
     * committedCacheRevision (bumped at COMMIT time), this records the
     * revision the committed pending carried at its last set() — so an
     * unscoped write made after the committed set but before the commit is
     * correctly seen as newer (review #601). Hydrate bumps it like the
     * committed revision since hydrated values are causally newest.
     */
    let committedSetRevision = 0;
    let cachedRevision = 0;
    let nextRevision = 0;
    const pendingWritesByOwner = new Map<object, AdapterPendingWrite>();
    let unscopedCommitOwner: object | undefined;
    /**
     * §119.2 — Cached canonical JSON of the last hydrate. Lets hydrate()
     * skip re-stringifying cachedValue on every sync message when the
     * incoming doc slot hasn't changed (hot path during multi-peer
     * collaboration).
     */
    let lastHydratedJson: string | null = null;
    /**
     * Audit CC-1 — document version identity at the last completed hydrate of a
     * *present* slot. Heads that have not moved mean the slot's bytes cannot
     * have changed, so the `lastHydratedJson` compare above would early-return
     * anyway; the check lets us reach that answer without stringifying the
     * slot. Only the present branch records it (the absent branch clears
     * `lastHydratedJson`), so the fast path stays exactly equivalent to the
     * JSON compare it replaces.
     */
    let lastHydratedHeads: string | null = null;
    /**
     * Listeners for visible-value changes that happen outside a synchronous
     * get/set/clear/hydrate call — a deferred rAF commit or abort landing
     * after an interleaved hydrate changed what get() returns, so the owning
     * store must re-notify its subscribers (the template-load e2e regression:
     * UI wedged on the hydrated value while get() already held the commit).
     */
    const deferredChangeListeners = new Set<() => void>();

    const notifyDeferredChange = (): void => {
        for (const listener of [...deferredChangeListeners]) {
            try {
                listener();
            } catch (error) {
                logger.warn('[AutomergeStorage] deferred-change listener failed:', error);
            }
        }
    };

    const toDocSafe = <TValue>(value: TValue): TValue => JSON.parse(JSON.stringify(value)) as TValue;

    const createMutation = (
        value: TData | null,
        baseValue: TData | null,
        message?: string,
        snapshotTransaction?: object
    ): AutomergeStorageMutationInput | null => {
        const port = getAutomergeStoragePort();
        if (!port) {
            return null;
        }

        if (!port.hasDoc(docId)) {
            return null;
        }

        const crdtValue = value !== null && toCrdt ? toCrdt(value) : value;
        // The base is narrowed the same way the value is, so the two describe
        // the same fields and a deletion can be told from a field this writer
        // never carried.
        const crdtBaseValue = baseValue !== null && toCrdt ? toCrdt(baseValue) : baseValue;

        return {
            docId,
            key,
            changeFn: (doc) => {
                if (crdtValue === null) {
                    delete doc[key];
                    return;
                }
                if (mutateCrdt) {
                    mutateCrdt({
                        doc,
                        key,
                        baseValue: crdtBaseValue,
                        value: toDocSafe(crdtValue as TData),
                    });
                    return;
                }
                reconcileCrdtSlot({
                    doc,
                    key,
                    baseValue: crdtBaseValue,
                    value: toDocSafe(crdtValue),
                    identityByField: crdtEntityIdentity,
                });
            },
            message,
            snapshotTransaction,
        };
    };

    const getSemanticMessage = (): string | undefined => {
        return getAutomergeStoragePort()?.getSemanticMessage();
    };

    const getWriteContext = (): AutomergeStorageWriteContext => {
        if (activeAutomergeStorageTransaction) {
            return { ...activeAutomergeStorageTransaction, scoped: true };
        }

        unscopedCommitOwner ??= Object.freeze({});
        return {
            commitOwner: unscopedCommitOwner,
            scoped: false,
            snapshotTransaction: undefined,
        };
    };

    const preparePendingWrite = (pending: AdapterPendingWrite): PendingWritePreparation => {
        if (pendingWritesByOwner.get(pending.write.commitOwner) !== pending) {
            // A newer pending already owns this slot; this one is inert and
            // its terminal is a no-op either way.
            return { status: 'defer' };
        }
        if (pending.rafId !== null) {
            cancelAnimationFrame(pending.rafId);
            pending.rafId = null;
        }
        // Superseded-write guard for UNSCOPED pendings: an rAF-deferred write
        // whose last set() predates the newest committed value would, on its
        // late flush, revert the CRDT slot — and recordCommittedWrite would
        // then surface the older value as the cache (the GrooveDropTarget
        // cache race: a pre-save write's slow rAF flush landed after the
        // save's scoped commit and dropped the just-committed template).
        // Scoped pendings are exempt: transaction commit order is deliberate
        // terminal order (compensating transactions legitimately commit older
        // values last).
        if (!pending.scoped && pending.revision < committedSetRevision) {
            return { status: 'abandon' };
        }

        const port = getAutomergeStoragePort();
        if (!port) {
            // The CRDT is not wired yet (store seeded from initialData before
            // bootstrap). Nothing has ever committed, so the seeded value is
            // the only state the app has — drop the write, keep the value.
            return { status: 'defer' };
        }
        if (!port.hasDoc(docId)) {
            // Before this adapter has observed project authority, an absent
            // document means there is no authority yet. Keep bootstrap defaults
            // and other pre-project state visible regardless of which animation
            // frame the port became available on.
            if (!hasObservedDocumentAuthority) {
                return { status: 'defer' };
            }
            // Audit CC-5 — once authoritative state has existed, a missing
            // document means this optimistic write belongs to outgoing truth.
            return { status: 'abandon' };
        }

        hasObservedDocumentAuthority = true;

        const mutation = createMutation(
            pending.value,
            pending.baseValue,
            pending.message,
            pending.write.snapshotTransaction
        );
        if (!mutation) {
            return { status: 'defer' };
        }
        return { status: 'ready', mutation };
    };

    const releasePendingWrite = (pending: AdapterPendingWrite): boolean => {
        if (pendingWritesByOwner.get(pending.write.commitOwner) !== pending) {
            return false;
        }
        if (pending.rafId !== null) {
            cancelAnimationFrame(pending.rafId);
            pending.rafId = null;
        }
        pendingAutomergeStorageWrites.delete(pending.write);
        pendingWritesByOwner.delete(pending.write.commitOwner);
        if (unscopedCommitOwner === pending.write.commitOwner) {
            unscopedCommitOwner = undefined;
        }
        return true;
    };

    const abortPendingWrite = (pending: AdapterPendingWrite): void => {
        if (!releasePendingWrite(pending)) {
            return;
        }
        const visibleBefore = cachedValue;
        recomputeCachedValue();
        if (!Object.is(visibleBefore, cachedValue)) {
            notifyDeferredChange();
        }
    };

    const recomputeCachedValue = (): void => {
        let visibleValue = committedCacheValue;
        let visibleRevision = committedCacheRevision;
        for (const remaining of pendingWritesByOwner.values()) {
            if (remaining.revision > visibleRevision) {
                visibleValue = remaining.value;
                visibleRevision = remaining.revision;
            }
        }
        cachedValue = visibleValue;
        cachedRevision = visibleRevision;
    };

    const recordCommittedWrite = (pending: AdapterPendingWrite): void => {
        if (!releasePendingWrite(pending)) {
            return;
        }
        const visibleBefore = cachedValue;

        hasObservedDocumentAuthority = true;
        committedCacheValue = pending.value;
        committedCacheRevision = ++nextRevision;
        committedSetRevision = pending.revision;
        for (const remaining of pendingWritesByOwner.values()) {
            remaining.baseValue = pending.value;
        }
        recomputeCachedValue();
        if (!Object.is(visibleBefore, cachedValue)) {
            notifyDeferredChange();
        }
    };

    const createPendingWrite = (context: AutomergeStorageWriteContext): AdapterPendingWrite => {
        // Capture the semantic context while the action is still active. The
        // first write in this adapter/action group owns its coalesced message.
        let pending: AdapterPendingWrite | undefined;
        const getPending = (): AdapterPendingWrite => {
            if (!pending) {
                throw new Error('Automerge storage pending write was not initialized');
            }
            return pending;
        };
        const write: PendingAutomergeStorageWrite = {
            abort: () => abortPendingWrite(getPending()),
            commitOwner: context.commitOwner,
            didCommit: () => recordCommittedWrite(getPending()),
            // Audit CC-5 — the deferred terminal. The write is dropped but
            // its value stays visible, because no committed value exists to
            // fall back to. A write whose value is *not* truth takes `abort`
            // instead, so the cache can never keep serving a write that will
            // never land.
            didDefer: () => releasePendingWrite(getPending()),
            docId,
            prepare: () => preparePendingWrite(getPending()),
            snapshotTransaction: context.snapshotTransaction,
        };
        pending = {
            baseValue: cachedValue,
            message: getSemanticMessage(),
            rafId: null,
            revision: cachedRevision,
            scoped: context.scoped,
            value: cachedValue,
            write,
        };
        pendingWritesByOwner.set(context.commitOwner, pending);
        pendingAutomergeStorageWrites.add(write);
        pending.rafId = requestAnimationFrame(() => {
            pending.rafId = null;
            try {
                flushAutomergeStorageWriteOwner(write);
            } catch (error) {
                logger.warn('[AutomergeStorage] CRDT write failed, in-memory state still updated:', error);
            }
        });
        return pending;
    };

    /**
     * Audit CC-2 — drop this projection so the outgoing project's value cannot
     * survive an authority switch. Pending writes are released (never flushed:
     * they belong to the replaced document), and the cache falls back to the
     * store's declared default.
     */
    const resetProjection = (): void => {
        for (const pending of [...pendingWritesByOwner.values()]) {
            releasePendingWrite(pending);
        }
        const visibleBefore = cachedValue;

        hasObservedDocumentAuthority = true;
        const defaultValue = hydrateMissing ? toDocSafe(hydrateMissing()) : null;
        committedCacheValue = defaultValue;
        committedCacheRevision = ++nextRevision;
        committedSetRevision = committedCacheRevision;
        cachedValue = defaultValue;
        cachedRevision = committedCacheRevision;
        lastHydratedJson = null;
        lastHydratedHeads = null;
        if (!Object.is(visibleBefore, cachedValue)) {
            notifyDeferredChange();
        }
    };

    const adapter: StorageAdapter<TData> = {
        registerInboundSanitizer(sanitize): void {
            inboundSanitizersBySlot.set(getInboundSanitizerKey(docId, key), (value) =>
                sanitize(fromCrdt ? fromCrdt(value as TData) : value)
            );
        },

        get(): TData | null {
            if (activeAutomergeStoragePreview) {
                return getPreviewValue(activeAutomergeStoragePreview);
            }
            return cachedValue;
        },

        set(value: TData | null): void {
            if (activeAutomergeStoragePreview) {
                setPreviewValue(activeAutomergeStoragePreview, value);
                return;
            }
            const context = getWriteContext();
            const pending = pendingWritesByOwner.get(context.commitOwner) ?? createPendingWrite(context);
            cachedValue = value;
            cachedRevision = ++nextRevision;
            pending.value = value;
            pending.revision = cachedRevision;
        },

        clear(): void {
            if (activeAutomergeStoragePreview) {
                setPreviewValue(activeAutomergeStoragePreview, null);
                return;
            }
            const context = getWriteContext();
            const pending = pendingWritesByOwner.get(context.commitOwner) ?? createPendingWrite(context);
            cachedValue = null;
            cachedRevision = ++nextRevision;
            pending.value = null;
            pending.revision = cachedRevision;
        },

        /**
         * The document is a wire format shared with peers that may run
         * different builds, and row validators here are structural and
         * version-blind — no protocol version is negotiated anywhere in the
         * sync layer. A peer whose validator still requires a field a newer
         * build removed rejects every row that lacks it. Refusing to surface
         * those rows is right; writing the refusal back is not, because the
         * deletion then propagates to peers that read them fine.
         *
         * So a sanitized value replaces the committed baseline and nothing
         * else. Every revision counter is deliberately left where it was:
         *
         * - `lastHydratedJson` / `lastHydratedHeads` describe the document,
         *   which has not changed.
         * - `committedCacheRevision` and `committedSetRevision` mean "a commit
         *   landed and superseded older writes". No commit landed here.
         *   Advancing `committedSetRevision` in particular makes
         *   `preparePendingWrite`'s supersede guard abandon an unflushed local
         *   edit that nothing actually superseded — the store would keep
         *   showing a value the document never received.
         *
         * The visible pending write needs correcting rather than outranking.
         * `sanitize` guards data arriving from outside and is deliberately
         * absent from the commit path, because a locally authored value is
         * built by a use case from typed models and the store must not quietly
         * rewrite what that use case asked to write. `hydrate`'s rebase branch
         * breaks that premise: it blends freshly-hydrated document data into an
         * in-flight write (`{ ...pendingValue, ...crdtData }`), so the pending
         * is no longer purely authored and its inbound half never passed the
         * guard. Racing it on revision order lets the rejected blend win the
         * cache and then flush to the document unexamined.
         *
         * So the pending whose value the sanitizer just examined — the visible
         * one, which is what `get()` returned — takes the verdict. That
         * corrects an injection `hydrate` made; it does not author a write, and
         * a pending nothing rebased still carries exactly what its use case
         * set.
         *
         * If you are adding a sanitizer, know what this relies on. It is
         * reached only when a sanitizer returns a value that is not reference-
         * identical to its input, so a sanitizer that short-circuits on accept
         * (`if (is_exact_X(value)) { return value; }`) keeps clean hydrates off
         * this path entirely. One that always rebuilds reaches it on *every*
         * hydrate, and this correction is deliberately blunt: it does not check
         * whether the rebase actually blended the visible pending or merely
         * touched its revision, and it does not exempt a scoped transactional
         * write. Those distinctions do not matter while clean values never get
         * here — give a new sanitizer the accept path and keep it that way.
         */
        setProjected(value: TData | null): void {
            const visibleBefore = cachedValue;
            committedCacheValue = value;
            const visiblePending = [...pendingWritesByOwner.values()].find(
                (pending) => pending.revision === cachedRevision
            );
            if (visiblePending) {
                visiblePending.value = value;
            }
            recomputeCachedValue();
            if (!Object.is(visibleBefore, cachedValue)) {
                notifyDeferredChange();
            }
        },

        isSupported(): boolean {
            return true;
        },

        isIsolated(): boolean {
            return activeAutomergeStoragePreview !== null;
        },

        subscribe(listener: () => void): () => void {
            deferredChangeListeners.add(listener);
            return () => {
                deferredChangeListeners.delete(listener);
            };
        },

        hydrate(): boolean {
            if (activeAutomergeStoragePreview) {
                return false;
            }
            const port = getAutomergeStoragePort();
            const doc = port?.getDoc(docId);
            if (!doc) {
                return false;
            }

            hasObservedDocumentAuthority = true;

            const heads = port?.getDocHeads?.(docId);
            const headsKey = heads ? heads.join(',') : null;
            if (headsKey !== null && headsKey === lastHydratedHeads) {
                return false;
            }

            const value = doc[key];
            if (value !== undefined) {
                // §119.1 — single strip pass via one JSON round-trip (the
                // Automerge proxy deref + undefined strip are unavoidable).
                // §119.2 — compare incoming against cached incoming rather
                // than re-stringifying cachedValue; 2 JSON ops per hydrate
                // instead of 3–4.
                let incomingValues: readonly unknown[] = [value];
                if (resolveConflicts || resolveCrdtConflicts) {
                    const conflicts = getConflicts(doc as Doc<AutomergeStorageReadableDoc>, key);
                    if (conflicts) {
                        incomingValues = Object.entries(conflicts)
                            .sort(([leftActor], [rightActor]) => {
                                if (leftActor < rightActor) {
                                    return -1;
                                }
                                if (leftActor > rightActor) {
                                    return 1;
                                }
                                return 0;
                            })
                            .map(([, conflictValue]) => conflictValue);
                    }
                }
                const incomingJson = JSON.stringify(incomingValues);
                if (incomingJson === lastHydratedJson) {
                    return false;
                }
                const rawValues = JSON.parse(incomingJson) as unknown[];
                const normalizedValues = fromCrdt
                    ? rawValues.map((rawValue) => fromCrdt(rawValue as TData))
                    : (rawValues as TData[]);
                const firstValue = normalizedValues[0];
                if (firstValue === undefined) {
                    return false;
                }
                let crdtData: TData = firstValue;
                if (resolveCrdtConflicts && rawValues.length > 1) {
                    crdtData = resolveCrdtConflicts(rawValues);
                } else if (resolveConflicts && normalizedValues.length > 1) {
                    crdtData = resolveConflicts(normalizedValues);
                }

                committedCacheValue = crdtData;
                committedCacheRevision = ++nextRevision;
                committedSetRevision = committedCacheRevision;

                const visiblePending = [...pendingWritesByOwner.values()].find(
                    (pending) => pending.revision === cachedRevision
                );
                if (visiblePending) {
                    let rebasedValue = visiblePending.value;
                    if (rebasePending) {
                        rebasedValue = rebasePending({
                            baseValue: visiblePending.baseValue,
                            pendingValue: visiblePending.value,
                            hydratedValue: crdtData,
                        });
                    } else if (
                        toCrdt &&
                        visiblePending.value !== null &&
                        typeof visiblePending.value === 'object' &&
                        typeof crdtData === 'object' &&
                        crdtData !== null
                    ) {
                        rebasedValue = { ...visiblePending.value, ...crdtData };
                    }
                    cachedValue = rebasedValue;
                    cachedRevision = ++nextRevision;
                    visiblePending.value = rebasedValue;
                    visiblePending.revision = cachedRevision;
                } else if (toCrdt && cachedValue !== null && typeof crdtData === 'object' && crdtData !== null) {
                    cachedValue = { ...cachedValue, ...crdtData };
                    cachedRevision = committedCacheRevision;
                    committedCacheValue = cachedValue;
                } else {
                    cachedValue = crdtData;
                    cachedRevision = committedCacheRevision;
                }
                lastHydratedJson = incomingJson;
                lastHydratedHeads = headsKey;
                return true;
            }

            // Audit CC-2 — the slot is absent from the document. A projection
            // is a pure reader: it supplies the store's default, it never
            // writes the stale cache back into truth. Writing here made the
            // projection a second writer, recursed into itself through the
            // projection bridge, and bled the previous project's cache into a
            // fresh document.
            lastHydratedHeads = null;
            if (cachedValue !== null && hydrateMissing) {
                const missing_value = toDocSafe(hydrateMissing());
                if (JSON.stringify(cachedValue) === JSON.stringify(missing_value)) {
                    return false;
                }
                cachedValue = missing_value;
                committedCacheValue = missing_value;
                committedCacheRevision = ++nextRevision;
                committedSetRevision = committedCacheRevision;
                cachedRevision = committedCacheRevision;
                lastHydratedJson = null;
                return true;
            }

            return false;
        },
    };

    automergeStorageProjections.add({ docId, resetProjection });

    return adapter;
};
