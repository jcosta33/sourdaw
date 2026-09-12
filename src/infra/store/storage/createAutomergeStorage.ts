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
    didApply?: () => void;
    isCurrent?: () => boolean;
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
    /** Whether the repository's active snapshot fence refuses this exact mutation identity. */
    isMutationBlockedBySnapshotTransaction?(docId: AutomergeStorageDocId, snapshotTransaction?: object): boolean;
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

type AutomergeStorageWriteMetadataHooks<TData, TWriteMetadata> = {
    capture(input: {
        readonly beforeValue: TData | null;
        readonly nextValue: TData | null;
        readonly operation: 'set' | 'clear';
    }): TWriteMetadata | null;
    reduce(input: { readonly current: TWriteMetadata | null; readonly captured: TWriteMetadata }): TWriteMetadata;
};

type AutomergeStorageOptions<TData, TWriteMetadata = never> = {
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
     * Explicit metadata-aware mutation path. Unlike the legacy `mutateCrdt`
     * hook, this receives whole-slot clears and fresh decoded authority.
     */
    mutateCrdtWithMetadata?: (input: {
        doc: AutomergeStorageMutableDoc;
        key: string;
        /** Fresh decoded slot authority from the draft being changed. */
        authorityValue: TData | null;
        /** The value this write was derived from, already narrowed by `toCrdt`. */
        baseValue: Partial<TData> | null;
        value: TData | null;
        /** Immutable owner-local intent captured by the adapter's opt-in write hook. */
        metadata: TWriteMetadata | null;
        /** Apply a domain-replayed value through the adapter's ordinary identity-aware reconciler. */
        reconcile(value: TData | null, baseValue: Partial<TData> | null): void;
    }) => void;
    /**
     * Whether an exact raw slot value is written in this adapter's own wire
     * encoding rather than the store's shape.
     *
     * `findAutomergeStorageRawProjectionLosses` asks whether the projection
     * still contains everything the raw slot held, which presumes the document
     * carries the store's own shape. An adapter owning its encoding writes a
     * form the store never has — entity maps keyed by id, tombstones, a schema
     * version — and `fromCrdt` decodes back out of it. Containment then fails on
     * every such value, and a permanent false loss holds the project in
     * repair-required. Detecting real loss there needs the inverse encoding,
     * which only the adapter has; until it offers one, such a value opts out.
     *
     * The opt-out is per value, not per adapter: an encoding is adopted when the
     * slot is next written, so a document saved by an older build still carries
     * the store's shape in that slot, where containment is a real question and
     * a real loss is observable.
     */
    ownsCrdtEncoding?: (raw: unknown) => boolean;
    /**
     * The raw slot value with the content this store discards on purpose
     * removed. `findAutomergeStorageRawProjectionLosses` compares the
     * projection against that pre-image rather than the document itself.
     * Defaults to identity.
     *
     * The detector's contract — anything the projection cannot return is loss —
     * has to stay exactly that strict, because an undeclared dropped key is how
     * a real projection defect announces itself. A store nevertheless drops some
     * keys by contract: transient view state an older build persisted by
     * mistake, a field retired from the model. There the projection is right and
     * the document is stale, but the detector cannot tell that from a defect,
     * and a document carrying such a key is held in repair-required forever —
     * which refuses every action and every save, including the save that would
     * have rewritten the document without it.
     *
     * A hook removes only what its sanitizer removes by contract, and only from
     * the raw side: applying it to the projection would hide real loss instead.
     */
    discardsRaw?: (raw: unknown) => unknown;
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
        metadata: TWriteMetadata | null;
    }) => TData | null;
    /** Opt in to immutable owner-local metadata captured at each actual set or clear. */
    writeMetadata?: AutomergeStorageWriteMetadataHooks<TData, TWriteMetadata>;
    /** Restore explicitly named runtime fields after committed durable authority is projected. */
    projectCommittedLocalState?: (input: { authorityValue: TData; localValue: TData }) => TData;
};

/**
 * An Automerge-backed adapter can force only its own rAF-deferred, unscoped
 * write to settle. The method is bound to the adapter's private commit owner;
 * callers cannot broaden it to another adapter or an open action transaction.
 */
export type AutomergeStorageAdapter<TData> = StorageAdapter<TData> & {
    flushPendingUnscopedWrite(): void;
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
 *   app has; drop the write but keep the value visible by retaining it as the
 *   effective committed baseline (issue #4109), where it survives later
 *   recomputes until a genuine commit, hydrate, or projection reset supersedes
 *   it. It stays a cache-level fallback and is never written through the port.
 */
type PendingWritePreparation =
    | { readonly status: 'ready'; readonly mutation: AutomergeStorageMutationInput }
    | { readonly status: 'abandon' }
    | { readonly status: 'defer' };

type PendingAutomergeStorageWrite = {
    readonly abort: () => void;
    readonly commitOwner: object;
    readonly didDefer: () => void;
    readonly docId: AutomergeStorageDocId;
    readonly scoped: boolean;
    readonly snapshotTransaction: object | undefined;
    readonly claim: () => ClaimedAutomergeStorageWrite | null;
};

type ClaimedAutomergeStorageWrite = Omit<PendingAutomergeStorageWrite, 'claim'> & {
    readonly didCommit: () => void;
    readonly didConflict: () => void;
    readonly isCurrent: () => boolean;
    readonly prepare: () => PendingWritePreparation;
    readonly releaseClaim: () => void;
};

type AutomergeStorageTransactionLifecycle = 'open' | 'committing' | 'committed' | 'aborted';

type ActiveAutomergeStorageTransaction = {
    readonly commitOwner: object;
    readonly snapshotTransaction: object | undefined;
    lifecycle: AutomergeStorageTransactionLifecycle;
};

const assertAutomergeStorageTransactionOpen = (transaction: ActiveAutomergeStorageTransaction): void => {
    if (transaction.lifecycle === 'open') {
        return;
    }
    if (transaction.lifecycle === 'committing') {
        throw new Error('Automerge storage transaction is committing');
    }
    throw new Error(`Automerge storage transaction has already settled (${transaction.lifecycle})`);
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

export class AutomergeStorageWriteConflictError extends AutomergeStorageTransactionValidationError {
    constructor(message: string) {
        super(message);
        this.name = 'AutomergeStorageWriteConflictError';
    }
}

export class AutomergeStorageSnapshotTransactionBlockedError extends AutomergeStorageWriteConflictError {
    constructor(docId: AutomergeStorageDocId) {
        super(`Automerge storage write to ${docId} is blocked by the active snapshot transaction`);
        this.name = 'AutomergeStorageSnapshotTransactionBlockedError';
    }
}

let automergeStoragePort: AutomergeStoragePort | null = null;
const pendingAutomergeStorageWrites = new Set<PendingAutomergeStorageWrite>();
const openAutomergeStorageCommitOwners = new Set<object>();
let activeAutomergeStorageTransaction: ActiveAutomergeStorageTransaction | undefined;
type AutomergeStorageMutationProvenance = {
    readonly owner: object | undefined;
};
let activeAutomergeStorageMutationProvenance: AutomergeStorageMutationProvenance | undefined;
let activeAutomergeStoragePreview: AutomergeStoragePreviewContext | null = null;
type InboundSanitizerEntry = {
    discardsRaw: (raw: unknown) => unknown;
    ownsCrdtEncoding: (raw: unknown) => boolean;
    sanitize: (value: unknown) => unknown;
};
const inboundSanitizersBySlot = new Map<string, InboundSanitizerEntry>();

/**
 * Exact storage transaction owner of the mutation currently reaching the
 * repository, or `undefined` for an unscoped mutation.
 *
 * A storage flush carries the scope captured when its pending write was
 * created, overriding whichever transaction happens to call the flush. With no
 * pending-write provenance, direct repository mutations fall back to the
 * ambient action transaction. This keeps delayed owned commits owned, foreign
 * buffered writes foreign, and direct in-action document mutations attributed
 * to the same exact owner as the action's adapter writes.
 */
export function getCurrentAutomergeStorageMutationOwner(): object | undefined {
    if (activeAutomergeStorageMutationProvenance) {
        return activeAutomergeStorageMutationProvenance.owner;
    }
    return activeAutomergeStorageTransaction?.commitOwner;
}

export function isAutomergeStorageMutationOwned(): boolean {
    return getCurrentAutomergeStorageMutationOwner() !== undefined;
}

function runWithAutomergeStorageMutationOwner<Result>(owner: object | undefined, callback: () => Result): Result {
    const previousProvenance = activeAutomergeStorageMutationProvenance;
    activeAutomergeStorageMutationProvenance = { owner };
    try {
        return callback();
    } finally {
        activeAutomergeStorageMutationProvenance = previousProvenance;
    }
}

function getInboundSanitizerKey(docId: string, key: string): string {
    return `${docId}\u0000${key}`;
}

/**
 * Whether `projected` still contains everything the raw slot held.
 *
 * Array containment is order-insensitive: inbound sanitizers legitimately
 * normalize row order (the automation sanitizer sorts each lane's points by
 * beat on entry, since `AutomationPoint` carries no id and the CRDT
 * reconciler whole-array-replaces such rows), and order is not content — the
 * detector's contract is content loss, not positional drift. Every raw item
 * must still be contained by a DISTINCT projected item, so a raw duplicate
 * with no second projected counterpart is a loss; extras in `projected` never
 * are.
 */
function projectionPreservesRawValue(raw: unknown, projected: unknown): boolean {
    if (Object.is(raw, projected)) {
        return true;
    }
    if (Array.isArray(raw)) {
        return (
            Array.isArray(projected) &&
            projected.length >= raw.length &&
            projectionContainsDistinctItems(raw, projected)
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

/**
 * Deterministic identity for the exact-content pre-pass: a recursively
 * key-sorted serialization, so equal content lands in one bucket regardless
 * of key order. Cost is linear in the value's size.
 */
function canonicalProjectionKey(value: unknown): string {
    if (typeof value !== 'object' || value === null) {
        return JSON.stringify(value) ?? 'undefined';
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalProjectionKey).join(',')}]`;
    }
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
        .toSorted()
        .map((key) => `${JSON.stringify(key)}:${canonicalProjectionKey(record[key])}`)
        .join(',')}}`;
}

/**
 * Containment of every raw item in a DISTINCT projected item, decided exactly.
 *
 * The check recurs synchronously on every document-origin projection (sync,
 * load, merge, branch switch), and sanitized output is quarantined rather
 * than written back, so the raw slot never converges to projected order —
 * the cost is paid again on every projection. Two passes shape it:
 *
 * The exact pre-pass claims without probing: projected items are bucketed by
 * canonical key and each raw item consumes one bucketed twin. Serialization
 * is linear in serialized content, so a slot whose rows the sanitizer
 * rebuilds into canonical twins of the raw rows pays a small multiple of one
 * positional walk, however many rows it holds — automation points, trim
 * points, ghost points routinely hold thousands. Only the containment
 * predicate decides the contract, so a claimed twin is one the predicate
 * confirms; serialization alone can collide (NaN and null both serialize as
 * `null`). A confirmed twin is deep-equal content, and containment is
 * transitive, so claiming it never turns a matchable remainder unmatchable.
 *
 * The ambiguous residue — raw items with no twin left — runs a complete
 * matching against the unclaimed projected items. Greedy first-fit is not
 * enough there: a narrow raw item can waste the only projected item wide
 * enough for a later one even though a distinct assignment exists. The
 * matching's cost rides on residue size times pool size times probe cost,
 * and each probe is linear in row size. Dropping or adding a key preserves
 * containment but changes the canonical key, so a row-rebuilding sanitizer
 * sends every deviant row to the residue — and a document whose row shapes
 * drifted across builds can send all of them, degrading the pass toward the
 * product of both array lengths. Canonical sort-and-compare of whole arrays
 * would also be too strict: per-item containment tolerates keys `projected`
 * gained.
 */
function projectionContainsDistinctItems(raw: readonly unknown[], projected: readonly unknown[]): boolean {
    const unclaimedTwinsByKey = new Map<string, unknown[]>();
    for (const item of projected) {
        const key = canonicalProjectionKey(item);
        const twins = unclaimedTwinsByKey.get(key);
        if (twins) {
            twins.push(item);
        } else {
            unclaimedTwinsByKey.set(key, [item]);
        }
    }
    const ambiguousRaw: unknown[] = [];
    for (const item of raw) {
        const twins = unclaimedTwinsByKey.get(canonicalProjectionKey(item));
        // Bucket occupancy, not the popped value, decides whether a twin
        // exists: `undefined` is a representable value and must be claimable.
        if (twins !== undefined && twins.length > 0) {
            const twin = twins.pop();
            if (projectionPreservesRawValue(item, twin)) {
                continue;
            }
            twins.push(twin);
        }
        ambiguousRaw.push(item);
    }
    if (ambiguousRaw.length === 0) {
        return true;
    }
    return projectionMatchesAmbiguousItems(ambiguousRaw, [...unclaimedTwinsByKey.values()].flat());
}

/**
 * Identity sentinel for a projected slot no raw item has claimed. `undefined`
 * cannot serve: it is a representable value in `unknown[]`, and a matched raw
 * row of `undefined` would read the slot as free again.
 */
const unclaimedProjectedSlot = Symbol('unclaimedProjectedSlot');

/**
 * Complete bipartite matching over the containment relation between the
 * ambiguous raw items and the projected items the exact pre-pass left
 * unclaimed, via Kuhn's augmenting paths: every ambiguous raw item is
 * matched to a distinct unclaimed projected item that recursively contains
 * it, or the set is reported unmatchable.
 */
function projectionMatchesAmbiguousItems(
    ambiguousRaw: readonly unknown[],
    unclaimedProjected: readonly unknown[]
): boolean {
    const matchedRawByProjected: unknown[] = Array.from(
        { length: unclaimedProjected.length },
        () => unclaimedProjectedSlot
    );
    const tryMatch = (item: unknown, visited: Uint8Array): boolean => {
        for (let candidateIndex = 0; candidateIndex < unclaimedProjected.length; candidateIndex += 1) {
            if (visited[candidateIndex] === 1) {
                continue;
            }
            if (!projectionPreservesRawValue(item, unclaimedProjected[candidateIndex])) {
                continue;
            }
            // Only a candidate the probe accepted is visited: a rejected
            // candidate is no edge for this item, and marking it would block
            // a free candidate an outer item still has an edge to.
            visited[candidateIndex] = 1;
            const owner = matchedRawByProjected[candidateIndex];
            if (owner === unclaimedProjectedSlot || tryMatch(owner, visited)) {
                matchedRawByProjected[candidateIndex] = item;
                return true;
            }
        }
        return false;
    };
    return ambiguousRaw.every((item) => tryMatch(item, new Uint8Array(unclaimedProjected.length)));
}

/**
 * Slots of `document` whose raw content the owning store's projection cannot
 * return, sorted — the evidence `inspectCurrentAgentProjectRepairState` arms
 * repair-required on.
 *
 * Content a store discards by contract is not loss: the slot's `discardsRaw`
 * hook removes it from the raw side first, and everything else the projection
 * drops still reports.
 */
export function findAutomergeStorageRawProjectionLosses(input: {
    docId: string;
    document: Readonly<Record<string, unknown>>;
}): string[] {
    const losses: string[] = [];
    for (const [slot, rawValue] of Object.entries(input.document)) {
        const entry = inboundSanitizersBySlot.get(getInboundSanitizerKey(input.docId, slot));
        // Containment is only well posed against a raw value in the store's own
        // shape; see `ownsCrdtEncoding`.
        if (!entry || entry.ownsCrdtEncoding(rawValue)) {
            continue;
        }
        try {
            if (!projectionPreservesRawValue(entry.discardsRaw(rawValue), entry.sanitize(rawValue))) {
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
    owner: object | undefined,
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
    return runWithAutomergeStorageMutationOwner(owner, () => {
        try {
            port.mutateDoc({
                docId: firstMutation.docId,
                changedKeys,
                changeFn: (doc) => {
                    for (const mutation of mutations) {
                        if (mutation.isCurrent && !mutation.isCurrent()) {
                            throw new Error('Automerge storage execution was invalidated before publication');
                        }
                        mutation.changeFn(doc);
                    }
                    const validationFailure = validateDocument?.(doc) ?? null;
                    if (validationFailure) {
                        throw new AutomergeStorageTransactionValidationError(validationFailure);
                    }
                    for (const mutation of mutations) {
                        if (mutation.isCurrent && !mutation.isCurrent()) {
                            throw new Error('Automerge storage execution was invalidated during publication');
                        }
                    }
                    for (const mutation of mutations) {
                        mutation.didApply?.();
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
    });
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
        assertAutomergeStorageTransactionOpen(capturedTransaction);
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
        lifecycle: 'open',
        snapshotTransaction,
    };
    activeAutomergeStorageTransaction = transaction;
    openAutomergeStorageCommitOwners.add(transaction.commitOwner);
    const commitValidators: Array<() => string | null> = [];
    const documentValidators = new Map<AutomergeStorageDocId, AutomergeStorageDocumentValidator>();
    let outcome: AutomergeStorageTransactionOutcome<Result>;

    const scope: AutomergeStorageTransactionScope = (scopedCallback) => {
        assertAutomergeStorageTransactionOpen(transaction);
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
            if (transaction.lifecycle === 'committed' || transaction.lifecycle === 'aborted') {
                return;
            }
            assertAutomergeStorageTransactionOpen(transaction);
            transaction.lifecycle = 'aborted';
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
            if (transaction.lifecycle === 'committed' || transaction.lifecycle === 'aborted') {
                return;
            }
            assertAutomergeStorageTransactionOpen(transaction);
            transaction.lifecycle = 'committing';
            try {
                for (const validateCommit of commitValidators) {
                    const validationFailure = validateCommit();
                    if (validationFailure) {
                        throw new AutomergeStorageTransactionValidationError(validationFailure);
                    }
                }
                openAutomergeStorageCommitOwners.delete(transaction.commitOwner);
                flushMatchingAutomergeStorageWrites(
                    (pending) =>
                        pending.commitOwner === transaction.commitOwner &&
                        pending.snapshotTransaction === transaction.snapshotTransaction,
                    documentValidators
                );
            } catch (error) {
                if (error instanceof AutomergeStorageFlushError && error.committedDocumentCount > 0) {
                    transaction.lifecycle = 'committed';
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

                transaction.lifecycle = 'open';
                openAutomergeStorageCommitOwners.add(transaction.commitOwner);
                throw error instanceof AutomergeStorageFlushError ? error.failure : error;
            }
            transaction.lifecycle = 'committed';
        },
        validateCommit(validator): void {
            assertAutomergeStorageTransactionOpen(transaction);
            commitValidators.push(validator);
        },
        validateDocument(docId, validator): void {
            assertAutomergeStorageTransactionOpen(transaction);
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
    const groups = new Map<string, Map<object, ClaimedAutomergeStorageWrite[]>>();
    const claims: ClaimedAutomergeStorageWrite[] = [];

    const selectedWrites = [...pendingAutomergeStorageWrites].filter(
        (pending) => matches(pending) && !openAutomergeStorageCommitOwners.has(pending.commitOwner)
    );
    const port = getAutomergeStoragePort();
    for (const pending of selectedWrites) {
        if (port?.isMutationBlockedBySnapshotTransaction?.(pending.docId, pending.snapshotTransaction)) {
            throw new AutomergeStorageSnapshotTransactionBlockedError(pending.docId);
        }
    }

    for (const pending of selectedWrites) {
        const claim = pending.claim();
        if (!claim) {
            continue;
        }
        claims.push(claim);

        let ownerGroups = groups.get(claim.docId);
        if (!ownerGroups) {
            ownerGroups = new Map();
            groups.set(claim.docId, ownerGroups);
        }

        const ownerWrites = ownerGroups.get(claim.commitOwner);
        if (ownerWrites) {
            ownerWrites.push(claim);
        } else {
            ownerGroups.set(claim.commitOwner, [claim]);
        }
    }

    try {
        for (const [docId, ownerGroups] of groups) {
            for (const writes of ownerGroups.values()) {
                const firstWrite = writes[0];
                if (!firstWrite) {
                    continue;
                }
                const mutations: AutomergeStorageMutationInput[] = [];
                const abandonedWrites: ClaimedAutomergeStorageWrite[] = [];
                let preparationFailed = false;
                let preparationUnavailable = false;

                for (const write of writes) {
                    try {
                        const preparation = write.prepare();
                        if (preparation.status === 'ready') {
                            if (!write.isCurrent()) {
                                preparationUnavailable = true;
                                continue;
                            }
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
                if (writes.some((write) => !write.isCurrent())) {
                    for (const write of writes) {
                        write.didDefer();
                    }
                    continue;
                }

                const outcome = commitAutomergeStorageMutations(
                    mutations,
                    firstWrite.scoped ? firstWrite.commitOwner : undefined,
                    documentValidators.get(docId)
                );
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
                    if (outcome.error instanceof AutomergeStorageWriteConflictError) {
                        for (const write of writes) {
                            try {
                                write.didConflict();
                            } catch (error) {
                                firstError ??= error;
                            }
                        }
                        for (const write of writes) {
                            try {
                                write.abort();
                            } catch (error) {
                                firstError ??= error;
                            }
                        }
                    }
                    continue;
                }

                // Both remaining outcomes moved the document.
                committedDocumentCount += 1;
                if (outcome.status === 'ambiguous') {
                    // `changeFn` completed before the failure, so the change is
                    // published and the durable terminal cannot be taken back —
                    // even for the first document.
                    firstError ??= outcome.error;
                }

                for (const write of writes) {
                    try {
                        write.didCommit();
                    } catch (error) {
                        firstError ??= error;
                        write.abort();
                    }
                }
            }
        }

        const port = getAutomergeStoragePort();
        for (const [docId, validateDocument] of documentValidators) {
            if (validatedDocumentIds.has(docId)) {
                continue;
            }
            try {
                const document = port?.getDoc(docId);
                const validationFailure = validateDocument(document ?? {});
                if (validationFailure) {
                    firstError ??= new AutomergeStorageTransactionValidationError(validationFailure);
                }
            } catch (error) {
                firstError ??= error;
            }
        }

        if (firstError !== undefined) {
            throw new AutomergeStorageFlushError(firstError, committedDocumentCount);
        }
    } finally {
        for (const claim of claims) {
            claim.releaseClaim();
        }
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

/** Exists so a test helper can prove a write it made added a pending write, not just that one already exists. */
export function countPendingAutomergeStorageWrites(): number {
    return pendingAutomergeStorageWrites.size;
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
export const createAutomergeStorage = <TData, TWriteMetadata = never>(
    docId: AutomergeStorageDocId,
    key: string,
    options?: AutomergeStorageOptions<TData, TWriteMetadata>
): AutomergeStorageAdapter<TData> => {
    const toCrdt = options?.toCrdt;
    const fromCrdt = options?.fromCrdt;
    const hydrateMissing = options?.hydrateMissing;
    const resolveConflicts = options?.resolveConflicts;
    const resolveCrdtConflicts = options?.resolveCrdtConflicts;
    const mutateCrdt = options?.mutateCrdt;
    const ownsCrdtEncoding = options?.ownsCrdtEncoding;
    const discardsRaw = options?.discardsRaw;
    const crdtEntityIdentity = options?.crdtEntityIdentity;
    const rebasePending = options?.rebasePending;
    const writeMetadata = options?.writeMetadata;
    const mutateCrdtWithMetadata = options?.mutateCrdtWithMetadata;
    const projectCommittedLocalState = options?.projectCommittedLocalState;
    type AdapterPendingWrite = {
        baseValue: TData | null;
        metadata: TWriteMetadata | null;
        message: string | undefined;
        rafId: number | null;
        revision: number;
        scoped: boolean;
        snapshotWaitToken: object | null;
        value: TData | null;
        write: PendingAutomergeStorageWrite;
        claimedExecution: ClaimedAutomergeStorageWrite | null;
    };
    let cachedValue: TData | null = null;
    let committedCacheValue: TData | null = null;
    let committedCacheRevision = 0;
    let absencePresentation: 'null' | 'default' = 'null';
    let projectionGeneration = 0;
    let acceptedAuthorityEpoch = 0;
    let inboundProjector:
        ((input: { value: TData | null; purpose: 'baseline' | 'visible' }) => TData | null) | undefined;
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

    const freezeMetadata = (metadata: TWriteMetadata): TWriteMetadata => {
        const cloned = toDocSafe(metadata);
        const freeze = (value: unknown): void => {
            if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
                return;
            }
            for (const child of Object.values(value)) {
                freeze(child);
            }
            Object.freeze(value);
        };
        freeze(cloned);
        return cloned;
    };

    const captureWriteMetadata = (
        beforeValue: TData | null,
        nextValue: TData | null,
        operation: 'set' | 'clear'
    ): TWriteMetadata | null => {
        if (!writeMetadata) {
            return null;
        }
        const captured = writeMetadata.capture({
            beforeValue: beforeValue === null ? null : toDocSafe(beforeValue),
            nextValue: nextValue === null ? null : toDocSafe(nextValue),
            operation,
        });
        return captured === null ? null : freezeMetadata(captured);
    };

    const appendWriteMetadata = (pending: AdapterPendingWrite, captured: TWriteMetadata | null): void => {
        if (captured === null || !writeMetadata) {
            return;
        }
        pending.metadata = freezeMetadata(
            writeMetadata.reduce({
                current: pending.metadata === null ? null : freezeMetadata(pending.metadata),
                captured,
            })
        );
    };

    const createMutation = (
        value: TData | null,
        baseValue: TData | null,
        message?: string,
        snapshotTransaction?: object,
        execution?: ClaimedAutomergeStorageWrite,
        metadata: TWriteMetadata | null = null
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
                if (mutateCrdtWithMetadata) {
                    const authorityValue = decodeDocumentValue(doc) ?? null;
                    mutateCrdtWithMetadata({
                        doc,
                        key,
                        authorityValue,
                        baseValue: crdtBaseValue,
                        value: crdtValue === null ? null : toDocSafe(crdtValue as TData),
                        metadata,
                        reconcile: (nextValue, nextBaseValue) => {
                            const nextCrdtValue = nextValue !== null && toCrdt ? toCrdt(nextValue) : nextValue;
                            if (nextCrdtValue === null) {
                                delete doc[key];
                                return;
                            }
                            reconcileCrdtSlot({
                                doc,
                                key,
                                baseValue: nextBaseValue,
                                value: toDocSafe(nextCrdtValue),
                                identityByField: crdtEntityIdentity,
                            });
                        },
                    });
                    return;
                }
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
            didApply: () => {
                if (execution && !execution.isCurrent()) {
                    throw new Error('Automerge storage execution was invalidated during publication');
                }
                absencePresentation = value === null ? 'null' : 'default';
            },
            isCurrent: execution?.isCurrent,
        };
    };

    const readRawDocumentValues = (document: AutomergeStorageReadableDoc): readonly unknown[] | undefined => {
        const rawValue = document[key];
        if (rawValue === undefined) {
            return undefined;
        }
        let incomingValues: readonly unknown[] = [rawValue];
        if (resolveConflicts || resolveCrdtConflicts) {
            const conflicts = getConflicts(document as Doc<AutomergeStorageReadableDoc>, key);
            if (conflicts) {
                incomingValues = Object.entries(conflicts)
                    .sort(([leftActor], [rightActor]) => leftActor.localeCompare(rightActor))
                    .map(([, conflictValue]) => conflictValue);
            }
        }
        return incomingValues;
    };

    const decodeClonedValues = (rawValues: readonly unknown[]): TData | undefined => {
        const normalizedValues = fromCrdt ? rawValues.map((raw) => fromCrdt(raw as TData)) : (rawValues as TData[]);
        const firstValue = normalizedValues[0];
        if (firstValue === undefined) {
            return undefined;
        }
        if (resolveCrdtConflicts && rawValues.length > 1) {
            return resolveCrdtConflicts(rawValues);
        }
        if (resolveConflicts && normalizedValues.length > 1) {
            return resolveConflicts(normalizedValues);
        }
        return firstValue;
    };

    const decodeDocumentValue = (document: AutomergeStorageReadableDoc): TData | undefined => {
        const incomingValues = readRawDocumentValues(document);
        if (!incomingValues) {
            return undefined;
        }
        return decodeClonedValues(JSON.parse(JSON.stringify(incomingValues)) as unknown[]);
    };

    const mergePartialAuthority = (localValue: TData | null, authorityValue: TData): TData => {
        if (toCrdt && localValue !== null && typeof localValue === 'object' && typeof authorityValue === 'object') {
            return { ...localValue, ...authorityValue };
        }
        return authorityValue;
    };

    const guardInboundValue = (value: TData | null, purpose: 'baseline' | 'visible'): TData | null => {
        if (!inboundProjector) {
            return value;
        }
        return inboundProjector({ value, purpose });
    };

    const getSemanticMessage = (): string | undefined => {
        return getAutomergeStoragePort()?.getSemanticMessage();
    };

    const getWriteContext = (): AutomergeStorageWriteContext => {
        if (activeAutomergeStorageTransaction) {
            assertAutomergeStorageTransactionOpen(activeAutomergeStorageTransaction);
            return { ...activeAutomergeStorageTransaction, scoped: true };
        }

        const unscopedPending = unscopedCommitOwner ? pendingWritesByOwner.get(unscopedCommitOwner) : undefined;
        if (unscopedPending?.claimedExecution) {
            unscopedCommitOwner = undefined;
        }
        unscopedCommitOwner ??= Object.freeze({});
        return {
            commitOwner: unscopedCommitOwner,
            scoped: false,
            snapshotTransaction: undefined,
        };
    };

    const preparePendingWrite = (
        pending: AdapterPendingWrite,
        execution: ClaimedAutomergeStorageWrite,
        frozen: Pick<AdapterPendingWrite, 'baseValue' | 'message' | 'metadata' | 'revision' | 'value'>
    ): PendingWritePreparation => {
        if (pendingWritesByOwner.get(pending.write.commitOwner) !== pending || pending.claimedExecution !== execution) {
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
        if (!pending.scoped && !writeMetadata && frozen.revision < committedSetRevision) {
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
            frozen.value,
            frozen.baseValue,
            frozen.message,
            pending.write.snapshotTransaction,
            execution,
            frozen.metadata
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
        pending.claimedExecution = null;
        pending.snapshotWaitToken = null;
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

    /**
     * Issue #4109 — a deferred write keeps its value visible beyond the next
     * recompute by becoming the effective committed baseline. The retained
     * baseline's invariants:
     *
     * - Cache-level fallback only. The write was dropped, so the value must
     *   never be written through the port; it lives solely where
     *   `recomputeCachedValue` can fall back to it. Only a later genuine store
     *   write may persist it.
     * - Superseded wholesale. A genuine committed write
     *   (`recordCommittedWrite`), a hydrate, and a projection reset each
     *   replace `committedCacheValue` entirely, so once real authority lands
     *   nothing resurrects the deferred value.
     * - Normal three-way semantics resume on the next touch. Any pending write
     *   or committed write to the slot again outranks or replaces the baseline
     *   by revision, exactly as before.
     */
    const retainDeferredBaseline = (pending: AdapterPendingWrite): void => {
        // A pending older than the current baseline is inert (its value
        // already lost to a newer write); releasing it must not demote the
        // baseline back to that older value.
        if (pending.revision <= committedCacheRevision) {
            return;
        }
        committedCacheValue = pending.value;
        committedCacheRevision = pending.revision;
    };

    const deferPendingWrite = (pending: AdapterPendingWrite): void => {
        if (!releasePendingWrite(pending)) {
            return;
        }
        retainDeferredBaseline(pending);
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

    const settleStaleCommittedWrite = (pending: AdapterPendingWrite, claimRevision: number): void => {
        if (!releasePendingWrite(pending)) {
            return;
        }
        const visibleBefore = cachedValue;
        committedCacheRevision = Math.max(committedCacheRevision, claimRevision);
        committedSetRevision = Math.max(committedSetRevision, claimRevision);
        for (const remaining of pendingWritesByOwner.values()) {
            remaining.baseValue = committedCacheValue;
        }
        recomputeCachedValue();
        if (!Object.is(visibleBefore, cachedValue)) {
            notifyDeferredChange();
        }
    };

    const rebasePendingWritesAfterConflict = (
        refusedPending: AdapterPendingWrite,
        claimRevision: number,
        authorityValue: TData | null,
        isCurrentAuthority: () => boolean
    ): void => {
        let projectedValue = authorityValue;
        const successors = [...pendingWritesByOwner.values()]
            .filter((candidate) => candidate !== refusedPending && candidate.revision > claimRevision)
            .sort((left, right) => left.revision - right.revision);
        for (const successor of successors) {
            const successorRevision = successor.revision;
            const isCurrentSuccessor = (): boolean =>
                isCurrentAuthority() &&
                pendingWritesByOwner.get(successor.write.commitOwner) === successor &&
                successor.revision === successorRevision;
            if (!isCurrentSuccessor()) {
                continue;
            }

            let rebasedValue = successor.value;
            if (rebasePending && projectedValue !== null) {
                rebasedValue = rebasePending({
                    baseValue: successor.baseValue,
                    pendingValue: successor.value,
                    hydratedValue: projectedValue,
                    metadata: successor.metadata === null ? null : freezeMetadata(successor.metadata),
                });
            } else if (
                toCrdt &&
                successor.value !== null &&
                typeof successor.value === 'object' &&
                typeof projectedValue === 'object' &&
                projectedValue !== null
            ) {
                rebasedValue = { ...successor.value, ...projectedValue };
            }
            if (!isCurrentSuccessor()) {
                continue;
            }
            const acceptedValue = guardInboundValue(rebasedValue, 'visible');
            if (!isCurrentSuccessor()) {
                continue;
            }
            if (rebasePending) {
                successor.baseValue = projectedValue;
            }
            successor.value = acceptedValue;
            projectedValue = acceptedValue;
        }
    };

    const recordWriteConflictAuthority = (pending: AdapterPendingWrite, claimRevision: number): void => {
        const execution = pending.claimedExecution;
        if (!execution?.isCurrent()) {
            return;
        }
        const generation = projectionGeneration;
        const projectionEpoch = acceptedAuthorityEpoch;
        const isCurrentProjection = (): boolean =>
            execution.isCurrent() && projectionGeneration === generation && acceptedAuthorityEpoch === projectionEpoch;
        const document = getAutomergeStoragePort()?.getDoc(docId);
        if (!document || !isCurrentProjection()) {
            return;
        }
        const decoded = decodeDocumentValue(document);
        if (!isCurrentProjection()) {
            return;
        }
        let projected: TData | null;
        if (decoded === undefined) {
            projected =
                absencePresentation === 'null'
                    ? null
                    : guardInboundValue(hydrateMissing ? toDocSafe(hydrateMissing()) : null, 'baseline');
        } else {
            projected = guardInboundValue(mergePartialAuthority(cachedValue, decoded), 'baseline');
        }
        if (!isCurrentProjection()) {
            return;
        }
        hasObservedDocumentAuthority = true;
        committedCacheValue = projected;
        // The claim was refused, so it advances the visible authority baseline
        // only through the value it had captured. It did not publish a local
        // set and therefore cannot supersede owners authored after that set.
        committedCacheRevision = Math.max(committedCacheRevision, claimRevision);
        if (decoded !== undefined) {
            absencePresentation = 'default';
        }
        acceptedAuthorityEpoch += 1;
        const conflictAuthorityEpoch = acceptedAuthorityEpoch;
        rebasePendingWritesAfterConflict(
            pending,
            claimRevision,
            decoded ?? projected,
            () =>
                execution.isCurrent() &&
                projectionGeneration === generation &&
                acceptedAuthorityEpoch === conflictAuthorityEpoch
        );
    };

    const recordCommittedWrite = (pending: AdapterPendingWrite, claimRevision: number): void => {
        const execution = pending.claimedExecution;
        if (!execution || !execution.isCurrent()) {
            return;
        }
        const projectionEpoch = acceptedAuthorityEpoch;
        const generation = projectionGeneration;
        const isCurrentProjection = (): boolean =>
            execution.isCurrent() && projectionGeneration === generation && acceptedAuthorityEpoch === projectionEpoch;
        const port = getAutomergeStoragePort();
        const document = port?.getDoc(docId);
        if (!document) {
            throw new Error(`Automerge storage committed document is unavailable: ${docId}`);
        }
        if (!isCurrentProjection()) {
            settleStaleCommittedWrite(pending, claimRevision);
            return;
        }

        const decoded = decodeDocumentValue(document);
        if (!isCurrentProjection()) {
            settleStaleCommittedWrite(pending, claimRevision);
            return;
        }
        const localValue = cachedValue;
        const projectionPurpose = pending.revision === cachedRevision ? 'visible' : 'baseline';
        let projected: TData | null;
        if (decoded === undefined) {
            projected =
                absencePresentation === 'null'
                    ? null
                    : guardInboundValue(hydrateMissing ? toDocSafe(hydrateMissing()) : null, projectionPurpose);
        } else {
            projected = guardInboundValue(mergePartialAuthority(localValue, decoded), projectionPurpose);
            if (!isCurrentProjection()) {
                settleStaleCommittedWrite(pending, claimRevision);
                return;
            }
            const currentLocalValue = cachedValue;
            if (projected !== null && currentLocalValue !== null && projectCommittedLocalState) {
                projected = projectCommittedLocalState({ authorityValue: projected, localValue: currentLocalValue });
            }
        }
        if (!isCurrentProjection()) {
            settleStaleCommittedWrite(pending, claimRevision);
            return;
        }
        if (!releasePendingWrite(pending)) {
            return;
        }
        const visibleBefore = cachedValue;

        hasObservedDocumentAuthority = true;
        committedCacheValue = projected;
        committedCacheRevision = Math.max(committedCacheRevision, claimRevision);
        committedSetRevision = Math.max(committedSetRevision, claimRevision);
        if (decoded !== undefined) {
            absencePresentation = 'default';
        }
        acceptedAuthorityEpoch += 1;
        for (const remaining of pendingWritesByOwner.values()) {
            remaining.baseValue = projected;
        }
        recomputeCachedValue();
        if (!Object.is(visibleBefore, cachedValue)) {
            notifyDeferredChange();
        }
    };

    const createPendingWrite = (
        context: AutomergeStorageWriteContext,
        initialMetadata: TWriteMetadata | null
    ): AdapterPendingWrite => {
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
            // Audit CC-5 — the deferred terminal. The write is dropped but
            // its value stays visible: the value is retained as the effective
            // committed baseline (issue #4109), so later recomputes fall back
            // to it until a genuine commit, hydrate, or projection reset
            // supersedes it. The retention is cache-level only and is never
            // written through the port. A write whose value is *not* truth
            // takes `abort` instead, so the cache can never keep serving a
            // write that will never land.
            didDefer: () => deferPendingWrite(getPending()),
            docId,
            claim: () => {
                const current = getPending();
                if (
                    pendingWritesByOwner.get(current.write.commitOwner) !== current ||
                    current.claimedExecution !== null
                ) {
                    return null;
                }
                const frozen = {
                    baseValue: current.baseValue,
                    message: current.message,
                    metadata: current.metadata === null ? null : freezeMetadata(current.metadata),
                    revision: current.revision,
                    value: current.value,
                };
                const execution: ClaimedAutomergeStorageWrite = {
                    abort: () => abortPendingWrite(current),
                    commitOwner: context.commitOwner,
                    didCommit: () => recordCommittedWrite(current, frozen.revision),
                    didConflict: () => recordWriteConflictAuthority(current, frozen.revision),
                    didDefer: () => deferPendingWrite(current),
                    docId,
                    isCurrent: () =>
                        pendingWritesByOwner.get(current.write.commitOwner) === current &&
                        current.claimedExecution === execution,
                    prepare: () => preparePendingWrite(current, execution, frozen),
                    releaseClaim: () => {
                        if (current.claimedExecution === execution) {
                            current.claimedExecution = null;
                        }
                    },
                    scoped: context.scoped,
                    snapshotTransaction: context.snapshotTransaction,
                };
                current.claimedExecution = execution;
                return execution;
            },
            scoped: context.scoped,
            snapshotTransaction: context.snapshotTransaction,
        };
        pending = {
            baseValue: cachedValue,
            metadata: initialMetadata,
            message: getSemanticMessage(),
            rafId: null,
            revision: cachedRevision,
            scoped: context.scoped,
            snapshotWaitToken: null,
            value: cachedValue,
            write,
            claimedExecution: null,
        };
        pendingWritesByOwner.set(context.commitOwner, pending);
        pendingAutomergeStorageWrites.add(write);
        schedulePendingWrite(pending);
        return pending;
    };

    const waitForSnapshotAndRetry = (pending: AdapterPendingWrite): void => {
        if (pending.snapshotWaitToken !== null) {
            return;
        }
        const token = Object.freeze({});
        const generation = projectionGeneration;
        pending.snapshotWaitToken = token;
        void waitForAutomergeSnapshotTransaction()
            .then(() => {
                if (
                    projectionGeneration !== generation ||
                    pending.snapshotWaitToken !== token ||
                    pendingWritesByOwner.get(pending.write.commitOwner) !== pending
                ) {
                    return;
                }
                pending.snapshotWaitToken = null;
                schedulePendingWrite(pending);
            })
            .catch((error: unknown) => {
                if (pending.snapshotWaitToken === token) {
                    pending.snapshotWaitToken = null;
                }
                logger.warn('[AutomergeStorage] Snapshot wait failed; deferred write remains pending:', error);
            });
    };

    const schedulePendingWrite = (pending: AdapterPendingWrite): void => {
        if (
            pending.rafId !== null ||
            pending.snapshotWaitToken !== null ||
            pendingWritesByOwner.get(pending.write.commitOwner) !== pending
        ) {
            return;
        }
        pending.rafId = requestAnimationFrame(() => {
            pending.rafId = null;
            try {
                flushAutomergeStorageWriteOwner(pending.write);
            } catch (error) {
                if (error instanceof AutomergeStorageSnapshotTransactionBlockedError) {
                    waitForSnapshotAndRetry(pending);
                    return;
                }
                logger.warn('[AutomergeStorage] CRDT write failed, in-memory state still updated:', error);
            }
        });
    };

    const settleMetadataPredecessor = (): void => {
        const commitOwner = unscopedCommitOwner;
        if (!commitOwner) {
            return;
        }
        const pending = pendingWritesByOwner.get(commitOwner);
        if (!pending) {
            return;
        }
        try {
            flushAutomergeStorageWriteOwner(pending.write);
        } catch (error) {
            if (
                error instanceof AutomergeStorageFlushError &&
                error.failure instanceof AutomergeStorageWriteConflictError
            ) {
                throw error.failure;
            }
            throw error;
        }
    };

    const prepareScopedValueAfterPredecessor = (
        context: AutomergeStorageWriteContext,
        intendedValue: TData | null,
        intentBase: TData | null,
        metadata: TWriteMetadata | null
    ): TData | null => {
        if (!context.scoped || !writeMetadata || !rebasePending) {
            return intendedValue;
        }
        if (pendingWritesByOwner.has(context.commitOwner)) {
            return intendedValue;
        }
        const predecessorOwner = unscopedCommitOwner;
        if (!predecessorOwner || !pendingWritesByOwner.has(predecessorOwner)) {
            return intendedValue;
        }
        settleMetadataPredecessor();
        if (cachedValue === null) {
            return intendedValue;
        }
        return guardInboundValue(
            rebasePending({
                baseValue: intentBase,
                pendingValue: intendedValue,
                hydratedValue: cachedValue,
                metadata,
            }),
            'visible'
        );
    };

    /**
     * Audit CC-2 — drop this projection so the outgoing project's value cannot
     * survive an authority switch. Pending writes are released (never flushed:
     * they belong to the replaced document), and the cache falls back to the
     * store's declared default.
     */
    const resetProjection = (): void => {
        projectionGeneration += 1;
        for (const pending of [...pendingWritesByOwner.values()]) {
            releasePendingWrite(pending);
        }
        const visibleBefore = cachedValue;
        const generation = projectionGeneration;
        const projectionEpoch = acceptedAuthorityEpoch;
        const defaultValue = hydrateMissing ? toDocSafe(hydrateMissing()) : null;
        if (projectionGeneration !== generation || acceptedAuthorityEpoch !== projectionEpoch) {
            return;
        }

        hasObservedDocumentAuthority = true;
        committedCacheValue = defaultValue;
        committedCacheRevision = ++nextRevision;
        committedSetRevision = committedCacheRevision;
        absencePresentation = 'default';
        cachedValue = defaultValue;
        cachedRevision = committedCacheRevision;
        lastHydratedJson = null;
        lastHydratedHeads = null;
        acceptedAuthorityEpoch += 1;
        if (!Object.is(visibleBefore, cachedValue)) {
            notifyDeferredChange();
        }
    };

    const adapter: AutomergeStorageAdapter<TData> = {
        flushPendingUnscopedWrite(): void {
            const commitOwner = unscopedCommitOwner;
            if (!commitOwner) {
                return;
            }
            const pending = pendingWritesByOwner.get(commitOwner);
            if (pending) {
                flushAutomergeStorageWriteOwner(pending.write);
            }
        },

        registerInboundSanitizer(sanitize): void {
            inboundSanitizersBySlot.set(getInboundSanitizerKey(docId, key), {
                discardsRaw: discardsRaw ?? ((raw) => raw),
                ownsCrdtEncoding: ownsCrdtEncoding ?? (() => false),
                sanitize: (value) => sanitize(fromCrdt ? fromCrdt(value as TData) : value),
            });
        },

        registerInboundProjector(project): void {
            inboundProjector = project;
            const visiblePending = [...pendingWritesByOwner.values()].find(
                (pending) => pending.revision === cachedRevision
            );
            if (!visiblePending || committedCacheValue === null) {
                return;
            }
            const generation = projectionGeneration;
            const projectionEpoch = acceptedAuthorityEpoch;
            const guardedBaseline = guardInboundValue(
                mergePartialAuthority(cachedValue, committedCacheValue),
                'baseline'
            );
            if (
                projectionGeneration !== generation ||
                acceptedAuthorityEpoch !== projectionEpoch ||
                pendingWritesByOwner.get(visiblePending.write.commitOwner) !== visiblePending
            ) {
                return;
            }
            committedCacheValue = guardedBaseline;
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
            const intentBase = cachedValue;
            const capturedMetadata = captureWriteMetadata(intentBase, value, 'set');
            const scopedValue = prepareScopedValueAfterPredecessor(context, value, intentBase, capturedMetadata);
            const existingPending = pendingWritesByOwner.get(context.commitOwner);
            const pending = existingPending ?? createPendingWrite(context, capturedMetadata);
            if (existingPending) {
                appendWriteMetadata(pending, capturedMetadata);
            }
            cachedValue = scopedValue;
            cachedRevision = ++nextRevision;
            pending.value = scopedValue;
            pending.revision = cachedRevision;
        },

        clear(): void {
            if (activeAutomergeStoragePreview) {
                setPreviewValue(activeAutomergeStoragePreview, null);
                return;
            }
            const context = getWriteContext();
            const intentBase = cachedValue;
            const capturedMetadata = captureWriteMetadata(intentBase, null, 'clear');
            const scopedValue = prepareScopedValueAfterPredecessor(context, null, intentBase, capturedMetadata);
            const existingPending = pendingWritesByOwner.get(context.commitOwner);
            const pending = existingPending ?? createPendingWrite(context, capturedMetadata);
            if (existingPending) {
                appendWriteMetadata(pending, capturedMetadata);
            }
            cachedValue = scopedValue;
            cachedRevision = ++nextRevision;
            pending.value = scopedValue;
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
         * A sanitized value replaces the visible pending projection when one
         * exists; otherwise it corrects the committed projection baseline.
         * It never authors shared truth. Every revision counter is deliberately
         * left where it was:
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
         * The registered projector guards document authority during hydrate
         * and committed terminal reads. `setProjected` remains the compatibility
         * path for constructor projection and adapters that cannot register that
         * guard. Hydrate can also blend document data into an in-flight write
         * (`{ ...pendingValue, ...crdtData }`); that visible blend takes the
         * projector verdict before it can flush.
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
            const visiblePending = [...pendingWritesByOwner.values()].find(
                (pending) => pending.revision === cachedRevision
            );
            if (visiblePending) {
                visiblePending.value = value;
            } else {
                committedCacheValue = value;
                absencePresentation = value === null ? 'null' : 'default';
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
            const generation = projectionGeneration;
            const projectionEpoch = acceptedAuthorityEpoch;
            const isCurrentProjection = (): boolean =>
                projectionGeneration === generation && acceptedAuthorityEpoch === projectionEpoch;
            const doc = port?.getDoc(docId);
            if (!doc || !isCurrentProjection()) {
                return false;
            }

            hasObservedDocumentAuthority = true;

            const heads = port?.getDocHeads?.(docId);
            if (!isCurrentProjection()) {
                return false;
            }
            const headsKey = heads ? heads.join(',') : null;
            if (headsKey !== null && headsKey === lastHydratedHeads) {
                return false;
            }

            const incomingValues = readRawDocumentValues(doc);
            if (!isCurrentProjection()) {
                return false;
            }
            if (incomingValues) {
                // §119.1 — single strip pass via one JSON round-trip (the
                // Automerge proxy deref + undefined strip are unavoidable).
                // §119.2 — compare incoming against cached incoming rather
                // than re-stringifying cachedValue; 2 JSON ops per hydrate
                // instead of 3–4.
                const incomingJson = JSON.stringify(incomingValues);
                if (incomingJson === lastHydratedJson) {
                    return false;
                }
                const rawValues = JSON.parse(incomingJson) as unknown[];
                const crdtData = decodeClonedValues(rawValues);
                if (crdtData === undefined || !isCurrentProjection()) {
                    return false;
                }

                const visiblePending = [...pendingWritesByOwner.values()].find(
                    (pending) => pending.revision === cachedRevision
                );
                const localSeed = cachedValue;
                if (visiblePending) {
                    const acceptedBaseline = guardInboundValue(mergePartialAuthority(localSeed, crdtData), 'baseline');
                    if (
                        !isCurrentProjection() ||
                        pendingWritesByOwner.get(visiblePending.write.commitOwner) !== visiblePending ||
                        visiblePending.revision !== cachedRevision
                    ) {
                        return false;
                    }
                    const authorityRevision = ++nextRevision;
                    committedCacheValue = acceptedBaseline;
                    committedCacheRevision = authorityRevision;
                    committedSetRevision = committedCacheRevision;
                    absencePresentation = 'default';
                    acceptedAuthorityEpoch += 1;

                    const visibleProjectionEpoch = acceptedAuthorityEpoch;
                    const isCurrentVisibleProjection = (): boolean =>
                        projectionGeneration === generation && acceptedAuthorityEpoch === visibleProjectionEpoch;
                    let rebasedValue = visiblePending.value;
                    if (rebasePending) {
                        rebasedValue = rebasePending({
                            baseValue: visiblePending.baseValue,
                            pendingValue: visiblePending.value,
                            hydratedValue: crdtData,
                            metadata: visiblePending.metadata === null ? null : freezeMetadata(visiblePending.metadata),
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
                    if (!isCurrentVisibleProjection()) {
                        return false;
                    }
                    if (
                        pendingWritesByOwner.get(visiblePending.write.commitOwner) !== visiblePending ||
                        visiblePending.revision !== cachedRevision
                    ) {
                        recomputeCachedValue();
                        lastHydratedJson = incomingJson;
                        lastHydratedHeads = headsKey;
                        return true;
                    }
                    const acceptedVisible = guardInboundValue(rebasedValue, 'visible');
                    if (!isCurrentVisibleProjection()) {
                        return false;
                    }
                    if (
                        pendingWritesByOwner.get(visiblePending.write.commitOwner) !== visiblePending ||
                        visiblePending.revision !== cachedRevision
                    ) {
                        recomputeCachedValue();
                        lastHydratedJson = incomingJson;
                        lastHydratedHeads = headsKey;
                        return true;
                    }
                    if (rebasePending) {
                        // Three-way base-advance (issue #3183): only the same
                        // visible pending that survived both projector guards
                        // may absorb the hydrated truth this rebase consumed.
                        // Re-anchoring at the hydrated value keeps the next
                        // pending delta purely local without granting a stale
                        // callback authority over a replacement pending.
                        visiblePending.baseValue = crdtData;
                    }
                    cachedValue = acceptedVisible;
                    cachedRevision = ++nextRevision;
                    visiblePending.value = acceptedVisible;
                    visiblePending.revision = cachedRevision;
                } else {
                    const acceptedValue = guardInboundValue(mergePartialAuthority(localSeed, crdtData), 'visible');
                    if (!isCurrentProjection()) {
                        return false;
                    }
                    const authorityRevision = ++nextRevision;
                    cachedValue = acceptedValue;
                    committedCacheValue = acceptedValue;
                    committedCacheRevision = authorityRevision;
                    committedSetRevision = committedCacheRevision;
                    recomputeCachedValue();
                    absencePresentation = 'default';
                    acceptedAuthorityEpoch += 1;
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
            if (cachedValue !== null && hydrateMissing) {
                const missingValue = guardInboundValue(toDocSafe(hydrateMissing()), 'visible');
                if (!isCurrentProjection()) {
                    return false;
                }
                if (JSON.stringify(cachedValue) === JSON.stringify(missingValue)) {
                    lastHydratedHeads = null;
                    return false;
                }
                cachedValue = missingValue;
                committedCacheValue = missingValue;
                committedCacheRevision = ++nextRevision;
                committedSetRevision = committedCacheRevision;
                cachedRevision = committedCacheRevision;
                absencePresentation = missingValue === null ? 'null' : 'default';
                lastHydratedJson = null;
                lastHydratedHeads = null;
                acceptedAuthorityEpoch += 1;
                return true;
            }

            if (isCurrentProjection()) {
                lastHydratedHeads = null;
            }
            return false;
        },
    };

    automergeStorageProjections.add({ docId, resetProjection });

    return adapter;
};
