export type StorageAdapter<TData> = {
    get(): TData | null;
    set(value: TData | null): void;
    clear(): void;
    isSupported(): boolean;
    /** True while this adapter is writing to an isolated command-preview projection. */
    isIsolated?(): boolean;
    /** Non-throwing `set`. Returns true only when the value is DURABLE —
     *  committed, at the moment of the call, to a backing store that outlives
     *  the session.
     *
     *  Implemented by adapters whose backing store can refuse a write for
     *  reasons the caller did not cause and cannot fix — a full origin quota, a
     *  `localStorage` that throws `SecurityError` outright (Safari private
     *  mode). `set` propagates those so a caller that can retry does; `trySet`
     *  is for callers that cannot, which is not a small set: every store
     *  declared at module scope seeds itself during module evaluation, where a
     *  throw aborts the ES module graph before any app-level catch exists.
     *
     *  A dropped write still changes the visible value — the caller is told it
     *  is not durable, not that it did not happen.
     *
     *  Implementing this is an affirmative claim, so an adapter that cannot
     *  make it omits it, and `createStore` reports `false` rather than reading
     *  a returning `set` as success. A `set` that returns has not necessarily
     *  persisted anything: `createAutomergeStorage` only records a pending
     *  write that a later `preparePendingWrite` can `abandon`, and memory
     *  storage has nothing to outlive the session at all. */
    trySet?(value: TData | null): boolean;
    /** Hydrate the cache from the backing store without triggering a write-back.
     *  Returns true if the cached value changed. */
    hydrate?(): boolean;
    /** Subscribe to visible-value changes that happen OUTSIDE a synchronous
     *  get/set/clear/hydrate call — e.g. a deferred CRDT write committing or
     *  aborting after an interleaved hydrate. Adapters without deferred
     *  visibility changes omit this. Returns an unsubscribe function. */
    subscribe?(listener: () => void): () => void;
    /** Replace the visible value WITHOUT authoring a write to the backing
     *  store.
     *
     *  Implemented only by adapters whose backing store is shared with other
     *  replicas. A sanitizer is a read-side guard: it decides what this build
     *  is willing to show, using a structural, version-blind validator. That
     *  makes it unfit to edit shared truth — it cannot distinguish a row a
     *  newer build wrote from a corrupt one, and rewriting a shared document
     *  from one replica's opinion deletes, for every peer, rows another build
     *  reads perfectly well.
     *
     *  Local-only adapters normally omit this because repair is the point.
     *  A versioned local store may opt in when an unrecognized future schema
     *  must remain byte-for-byte available to the newer build that authored
     *  it, while this build exposes only a safe empty projection. */
    setProjected?(value: TData | null): void;
    /** Decide whether one sanitizer input must be projected rather than
     *  repaired. Shared adapters omit this and always project; versioned local
     *  adapters use it to quarantine only explicit unsupported schemas. */
    shouldProjectSanitizedSource?(value: unknown): boolean;
    /** Register the store's inbound sanitizer so shared raw CRDT content can
     *  be checked for projection loss before any read model is hydrated. */
    registerInboundSanitizer?(sanitize: (value: unknown) => unknown): void;
};
