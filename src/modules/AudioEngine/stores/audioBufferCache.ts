import { logger } from '#/infra/logger/appLogger';

/** Serialized form of an AudioBuffer embedded inside a .sourdaw project file.
 * Each channel's Float32 PCM data is base64-encoded to survive JSON round-trips.
 *
 * This shape exists for the explicit, user-initiated `.sourdaw` export and the
 * import that reads one back. No live persistence path produces it: the save
 * snapshot references buffers by id and the PCM itself lives in this module's
 * IndexedDB store as raw `Float32Array` (ADR 0013 decision 2). */
export type ExportedAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    /** One base64-encoded Float32Array string per channel, in channel order. */
    channelData: string[];
    freezeProjectId?: number;
};

/** Base64-encode one channel of PCM for the `.sourdaw` export. The only caller
 * is `exportBuffers`; nothing on a live persistence path may reach this. */
async function float32ToBase64(arr: Float32Array): Promise<string> {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const CHUNK = 8192;
    const YIELD_EVERY = 32; // yield to main thread every 32 chunks (~256 KB)
    let binary = '';
    let chunkIndex = 0;
    for (let index = 0; index < bytes.length; index += CHUNK) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + CHUNK)));
        if (++chunkIndex % YIELD_EVERY === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
    }
    return btoa(binary);
}

function base64ToFloat32(b64: string): Float32Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Float32Array(bytes.buffer);
}

function isValidExportedAudioBuffer(data: ExportedAudioBuffer): boolean {
    if (
        !Number.isFinite(data.sampleRate) ||
        data.sampleRate <= 0 ||
        !Number.isInteger(data.numberOfChannels) ||
        data.numberOfChannels <= 0 ||
        data.channelData.length !== data.numberOfChannels ||
        (data.freezeProjectId !== undefined &&
            (!Number.isSafeInteger(data.freezeProjectId) || data.freezeProjectId < 0))
    ) {
        return false;
    }
    let byteLength: number | undefined;
    try {
        for (const channel of data.channelData) {
            const length = atob(channel).length;
            if (length === 0 || length % Float32Array.BYTES_PER_ELEMENT !== 0) {
                return false;
            }
            byteLength ??= length;
            if (length !== byteLength) {
                return false;
            }
        }
    } catch {
        return false;
    }
    return true;
}

// Main AudioBuffer cache. Non-project buffers are LRU bounded; buffers needed by
// the active arrangement stay pinned because scheduling reads are synchronous.
const MAX_AUDIO_BUFFER_ENTRIES = 64;
const cache = new Map<string, AudioBuffer>();
const pinnedBufferIds = new Set<string>();
const residentFreezeProjectIdById = new Map<string, number | undefined>();
let nextBufferLifecycleEpoch = 0;
let runtimeClearEpoch = 0;
const bufferLifecycleEpochById = new Map<string, number>();
const activeBufferReopenCountById = new Map<string, number>();

type BufferLifecycleSnapshot = {
    bufferEpoch: number | undefined;
    clearEpoch: number;
};

function bumpBufferLifecycleEpoch(id: string): void {
    bufferLifecycleEpochById.set(id, ++nextBufferLifecycleEpoch);
}

function beginBufferReopen(id: string): BufferLifecycleSnapshot {
    activeBufferReopenCountById.set(id, (activeBufferReopenCountById.get(id) ?? 0) + 1);
    return { bufferEpoch: bufferLifecycleEpochById.get(id), clearEpoch: runtimeClearEpoch };
}

function finishBufferReopen(id: string): void {
    const remaining = (activeBufferReopenCountById.get(id) ?? 1) - 1;
    if (remaining > 0) {
        activeBufferReopenCountById.set(id, remaining);
        return;
    }
    activeBufferReopenCountById.delete(id);
    if (!cache.has(id) && !persistenceGenerationById.has(id)) {
        bufferLifecycleEpochById.delete(id);
    }
}

function isBufferLifecycleCurrent(id: string, snapshot: BufferLifecycleSnapshot): boolean {
    return snapshot.bufferEpoch === bufferLifecycleEpochById.get(id) && snapshot.clearEpoch === runtimeClearEpoch;
}

function audioCacheSet(id: string, buffer: AudioBuffer, freezeProjectId?: number, ownershipKnown = false): void {
    bumpBufferLifecycleEpoch(id);
    // Promote existing entry to MRU position
    if (cache.has(id)) {
        cache.delete(id);
    } else {
        while (cache.size >= MAX_AUDIO_BUFFER_ENTRIES) {
            let lruKey: string | undefined;
            for (const key of cache.keys()) {
                if (!pinnedBufferIds.has(key)) {
                    lruKey = key;
                    break;
                }
            }
            if (lruKey === undefined) {
                break;
            }
            evictCachedBuffer(lruKey);
        }
    }
    cache.set(id, buffer);
    if (ownershipKnown) {
        residentFreezeProjectIdById.set(id, freezeProjectId);
    } else {
        residentFreezeProjectIdById.delete(id);
    }
}

function replacePinnedBufferIds(ids: readonly string[]): void {
    pinnedBufferIds.clear();
    for (const id of ids) {
        pinnedBufferIds.add(id);
    }
    while (cache.size > MAX_AUDIO_BUFFER_ENTRIES) {
        let lruKey: string | undefined;
        for (const key of cache.keys()) {
            if (!pinnedBufferIds.has(key)) {
                lruKey = key;
                break;
            }
        }
        if (lruKey === undefined) {
            break;
        }
        evictCachedBuffer(lruKey);
    }
}

function audioCacheGet(id: string): AudioBuffer | undefined {
    const buf = cache.get(id);
    if (buf !== undefined) {
        // Promote to MRU position
        cache.delete(id);
        cache.set(id, buf);
    }
    return buf;
}

// Waveform peak cache bounded to avoid unbounded memory growth.
// Each entry stores Float32Array peaks for a specific (bufferId, numBins) pair.
// Capped at MAX_WAVEFORM_CACHE_ENTRIES: oldest entries are evicted LRU-style.
const MAX_WAVEFORM_CACHE_ENTRIES = 256;
const waveformCache = new Map<string, Float32Array>();

function waveformCacheSet(key: string, peaks: Float32Array): void {
    if (waveformCache.size >= MAX_WAVEFORM_CACHE_ENTRIES) {
        // Evict oldest entry (Map preserves insertion order)
        const firstKey = waveformCache.keys().next().value;
        if (firstKey !== undefined) {
            waveformCache.delete(firstKey);
        }
    }
    waveformCache.set(key, peaks);
}

const DB_NAME = 'sourdaw-audio';
const DB_VERSION = 2;
const STORE_NAME = 'buffers';

/** Everything the age and size collectors read, split out of the record so that
 * moving a timestamp does not rewrite the audio next to it.
 *
 * A record is `sampleRate` and `numberOfChannels` and then however many
 * megabytes of `Float32Array`; the two numbers the collectors want are 16 bytes
 * of it. IndexedDB has no partial update, so `put`ting a record back to change
 * `lastAccessed` rewrites the PCM — 384 KB per second of 48 kHz stereo, so
 * ~1.5 MB for a four-second loop and ~69 MB for a three-minute freeze bounce,
 * once per id per refresh window, forever. And both collectors reached those
 * two numbers through `getAll()`, materialising every record in the store to
 * read them; `cleanupUnusedFreezeFiles` caps that store at 2 GiB.
 *
 * Measured in `audioBufferCacheMetadataStore.spec.ts` on one second of 48 kHz
 * stereo: a refresh wrote 384 152 bytes and now writes 62, and a two-record
 * collector pass read 768 322 bytes (age) / 768 324 (size) and now reads 142 /
 * 144 — the rows and their keys, and no PCM at all.
 *
 * The record keeps its own `lastAccessed` and `sizeInBytes` fields. They stop
 * being the collectors' input at this version and become what the record was
 * persisted with — which is exactly what the lazy back-fill needs to seed a row
 * for a record written before this store existed. */
const META_STORE_NAME = 'bufferMeta';

type BufferMeta = {
    freezeProjectId?: number;
    lastAccessed: number;
    preparedOwner?: PreparedBufferOwner;
    sizeInBytes: number;
};

type PreparedBufferOwner = {
    schemaVersion: 1;
    leaseId: string;
    status: 'project-owned' | 'temporary';
};

/** One connection for the life of the module (audit M-045). `get()` and
 * `getWaveformPeaks()` run per clip per timeline paint, and each one refreshes
 * the buffer's access stamp; before this, every one of those calls opened its
 * own IndexedDB connection that nothing ever closed. Measured in
 * `audioBufferCacheConnectionChurn.spec.ts`: one persist plus six reads that
 * each refreshed a stamp issued seven `indexedDB.open` calls, and now issue
 * one. (Reverting only this memo, with refresh coalescing left in place, gives
 * two — one for the persist and one for the single surviving refresh.)
 *
 * `IDBDatabase` is designed to be held, so the memo is the platform's own
 * shape rather than a pool. It self-heals in the two ways a held connection can
 * go bad while the database is still ours to open: a failed open is forgotten
 * so the next caller retries, and an abnormal `close` drops the memo so the
 * next caller reconnects instead of reusing a dead handle. The generation
 * counter keeps a late loss event from clearing a memo that has already been
 * replaced. `versionchange` is the third way, and it does not reconnect — see
 * `versionChangeLatched`. */
let dbPromise: Promise<IDBDatabase> | null = null;
let dbConnectionGeneration = 0;

/** `versionchange` means another context is upgrading or deleting this database
 * and is blocked on our connection. Closing is necessary but not sufficient:
 * the very next timeline paint calls `refreshAccessTime` -> `openDb()`, which
 * would reconnect within a frame and re-block the upgrade it just yielded to.
 * So the close latches, and `openDb()` refuses for the rest of the page's life.
 *
 * Playback and waveform drawing are unaffected, because the decoded buffers
 * live in the in-memory `cache` and nothing here touches it. Persistence,
 * removal, the access-time refresh and the store clear degrade to a warning.
 *
 * It is **not** true that only durability pauses. `exportBuffers` resolves
 * ids the LRU has evicted by reading them back out of IDB, and that read is
 * now permanently unavailable, so a `.sourdaw` export taken while latched
 * omits the PCM for every non-resident id. The in-memory cache holds 64
 * entries, so any project past that exports short. It is reported rather than
 * silent — the omissions become `buildProjectData`'s `missingBufferCount` and
 * `exportProjectFile` raises a user-facing warning — but the file is still
 * written, and no reload un-writes a file already on disk.
 *
 * The `DB_VERSION` 1 -> 2 bump for the metadata store is what makes that
 * reachable: until it, no build ever asked for a version another build did not
 * already have, so nothing could fire `versionchange` and this whole latch was
 * inert. It is live from that version on, for anyone with two tabs open across
 * the upgrade. A gate on the load side is queued separately and is not this
 * change; what is not still outstanding is the refresh half — `refreshAccessTime`
 * reads the latch on entry and returns, so the once-per-id-per-window warning
 * this comment used to warn about does not happen.
 *
 * Nothing resets this in-process on purpose. The upgrade completing is not an
 * event this context can observe, and the reason to reconnect afterwards would
 * be to talk to a schema this module was not compiled against. A reload
 * re-evaluates this module against the new schema, which is the only point at
 * which reconnecting is correct.
 *
 * The latch is read on entry to `openDb()`, so it cannot rescue a caller that
 * already holds a resolved connection when `versionchange` fires — that one
 * still gets `InvalidStateError` off the closed handle. Nothing in this file
 * is exposed to that today, and the reason is an invariant with no guard on
 * it: **every `await openDb()` here is followed synchronously by
 * `db.transaction()`**. `versionchange` is delivered as a task while the
 * post-`await` continuation is a microtask, so no `versionchange` can be
 * interleaved between the two. Put any new `await` between an `openDb()` and
 * its `transaction()` and that stops being true. */
let versionChangeLatched = false;

const VERSION_CHANGE_LATCH_MESSAGE = 'IDB connection surrendered to a versionchange; reload to reconnect';

const OPEN_BLOCKED_MESSAGE = 'IDB open blocked by another connection at an older version';

function openDbConnection(onConnectionLoss: () => void): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        // `blocked` becomes reachable at the same moment `versionchange` does:
        // it fires when another context still holds a connection at the older
        // version and has not closed it. Until the `DB_VERSION` bump no build
        // ever asked for a version another build did not have, so neither event
        // could occur.
        //
        // Unhandled, this is the one consequence of the bump that *hangs*
        // rather than degrades. A blocked open fires neither `success` nor
        // `error`, so the promise never settles, and `openDb` memoises it —
        // every later caller joins the same pending promise, and `dbPromise` is
        // only ever cleared by `forgetIfCurrent`, which needs a rejection to
        // run. `restoreFromIdb` would sit mid project load instead of reaching
        // its `catch` and publishing zero buffers.
        //
        // So it rejects. Degrading immediately is right for this store even
        // though the block may clear on its own: playback and waveforms read
        // the in-memory cache and are unaffected, the memo is cleared so the
        // next caller retries, and a `catch` that runs is worth more than a
        // connection that might arrive.
        let settled = false;
        req.onblocked = () => {
            if (settled) {
                return;
            }
            settled = true;
            reject(new Error(OPEN_BLOCKED_MESSAGE));
        };
        req.onupgradeneeded = () => {
            // Creates stores and nothing else. A v1 -> v2 back-fill that walked
            // the records here would hold the upgrade transaction — and every
            // context waiting on it — for as long as it takes to read a store
            // the freeze cleanup allows to reach 2 GiB, on the startup path.
            //
            // The rows are seeded lazily instead, from three places:
            // `persistSerializedToIdb` and the import persist write one
            // alongside every record from now on; `updateAccessTimeInIdb` seeds
            // one from the record the first time a legacy id's stamp is
            // refreshed; and `garbageCollectByAge` sweeps whatever is left
            // within a byte budget, which is the only one of the three that can
            // reach a record no project references.
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
            if (!db.objectStoreNames.contains(META_STORE_NAME)) {
                db.createObjectStore(META_STORE_NAME);
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            if (settled) {
                // Already reported blocked and the caller has moved on. Holding
                // this handle would block the very upgrade we yielded to, so it
                // is closed rather than resolved or leaked.
                db.close();
                return;
            }
            settled = true;
            db.onversionchange = () => {
                // Another context wants to upgrade or delete the database;
                // holding this connection open would block it indefinitely.
                // Latch before closing: dropping the memo without the latch just
                // hands the next caller a fresh connection that blocks it again.
                versionChangeLatched = true;
                db.close();
                onConnectionLoss();
            };
            db.onclose = onConnectionLoss;
            resolve(db);
        };
        req.onerror = () => {
            if (settled) {
                return;
            }
            settled = true;
            reject(req.error ?? new Error('IDB request failed'));
        };
    });
}

function openDb(): Promise<IDBDatabase> {
    if (versionChangeLatched) {
        return Promise.reject(new Error(VERSION_CHANGE_LATCH_MESSAGE));
    }
    if (dbPromise !== null) {
        return dbPromise;
    }
    dbConnectionGeneration++;
    const generation = dbConnectionGeneration;
    function forgetIfCurrent(): void {
        if (dbConnectionGeneration === generation) {
            dbPromise = null;
        }
    }
    dbPromise = openDbConnection(forgetIfCurrent).catch((error: unknown) => {
        // A failed open (including `indexedDB` being unavailable) must not
        // poison the memo, or one transient failure would disable persistence
        // for the rest of the session.
        forgetIfCurrent();
        throw error;
    });
    return dbPromise;
}

/** Resolve with a request's result. An IndexedDB request's `success` fires
 * before the transaction commits (IDB 3.0 §5.6), so this is only ever used to
 * *read* — never to report a write as durable. */
function awaitRequest<Result>(request: IDBRequest<Result>): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
}

/** Resolve when the transaction has actually committed. Rejects on `error` and
 * on `abort` — a bare abort fires neither `error` nor `complete`, so an
 * `onabort`-less promise here would stay pending forever. */
function awaitTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('IDB transaction aborted'));
        transaction.onerror = () => reject(transaction.error ?? new Error('IDB transaction failed'));
    });
}

type SerializedBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: Float32Array[];
    lastAccessed: number;
    sizeInBytes: number;
};

let nextPersistenceGeneration = 0;
const persistenceGenerationById = new Map<string, number>();
type PreparedPersistenceAttempt = {
    generation: number;
    settled: Promise<void>;
    settle: () => void;
};
const preparedPersistenceAttemptById = new Map<string, PreparedPersistenceAttempt>();
let nextImportCandidateId = 0;
let activeImportCandidateId = 0;
let committedImportCandidateId = 0;
const importPersistenceTransactions = new Map<number, IDBTransaction>();

function cancelPendingImportCandidate(): void {
    activeImportCandidateId = ++nextImportCandidateId;
    abortImportPersistenceExcept(activeImportCandidateId);
}

function abortImportPersistenceExcept(candidateId: number): void {
    for (const [persistingCandidateId, transaction] of importPersistenceTransactions) {
        if (persistingCandidateId === candidateId) {
            continue;
        }
        try {
            transaction.abort();
        } catch {
            // The transaction already completed between inspection and abort.
        }
    }
}

function cancelAllImportCandidates(): void {
    cancelPendingImportCandidate();
    committedImportCandidateId = 0;
}

function claimPersistenceGeneration(id: string): number {
    const generation = ++nextPersistenceGeneration;
    persistenceGenerationById.set(id, generation);
    return generation;
}

function registerPreparedPersistenceAttempt(id: string, generation: number): PreparedPersistenceAttempt {
    let settle = (): void => undefined;
    const settled = new Promise<void>((resolve) => {
        settle = resolve;
    });
    const attempt = { generation, settled, settle };
    preparedPersistenceAttemptById.set(id, attempt);
    return attempt;
}

async function waitForSupersedingPreparedPersistence(id: string, generation: number): Promise<void> {
    for (;;) {
        const attempt = preparedPersistenceAttemptById.get(id);
        if (!attempt || attempt.generation <= generation) {
            return;
        }
        await attempt.settled;
    }
}

function serializeBuffer(buffer: AudioBuffer): SerializedBuffer {
    const channelData: Float32Array[] = [];
    let sizeInBytes = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const data = new Float32Array(buffer.getChannelData(ch));
        channelData.push(data);
        sizeInBytes += data.byteLength;
    }
    return {
        sampleRate: buffer.sampleRate,
        numberOfChannels: buffer.numberOfChannels,
        channelData,
        lastAccessed: Date.now(),
        sizeInBytes,
    };
}

function isFloat32Array(value: unknown): value is Float32Array {
    return Object.prototype.toString.call(value) === '[object Float32Array]';
}

function isValidSerializedBuffer(data: SerializedBuffer | undefined): data is SerializedBuffer {
    if (!data || !Array.isArray(data.channelData)) {
        return false;
    }
    const length = data.channelData[0]?.length ?? 0;
    const sizeInBytes = data.channelData.reduce((total, channel) => total + channel.byteLength, 0);
    return (
        Number.isFinite(data.sampleRate) &&
        data.sampleRate > 0 &&
        Number.isInteger(data.numberOfChannels) &&
        data.numberOfChannels > 0 &&
        length > 0 &&
        data.channelData.length === data.numberOfChannels &&
        data.channelData.every((channel) => isFloat32Array(channel) && channel.length === length) &&
        Number.isFinite(data.lastAccessed) &&
        data.sizeInBytes === sizeInBytes
    );
}

function readPreparedBufferOwner(meta: BufferMeta | undefined): PreparedBufferOwner | null | 'invalid' {
    const owner = meta?.preparedOwner;
    if (owner === undefined) {
        return null;
    }
    if (
        owner === null ||
        typeof owner !== 'object' ||
        owner.schemaVersion !== 1 ||
        typeof owner.leaseId !== 'string' ||
        owner.leaseId.length === 0 ||
        (owner.status !== 'temporary' && owner.status !== 'project-owned')
    ) {
        return 'invalid';
    }
    return owner;
}

function isReplaceablePreparedBuffer(data: SerializedBuffer | undefined, meta: BufferMeta | undefined): boolean {
    const owner = readPreparedBufferOwner(meta);
    return (
        isValidSerializedBuffer(data) &&
        !!meta &&
        Number.isFinite(meta.lastAccessed) &&
        meta.sizeInBytes === data.sizeInBytes &&
        owner !== 'invalid' &&
        owner?.status === 'temporary'
    );
}

async function readPreparedOwnerFromIdb(id: string): Promise<PreparedBufferOwner | null | 'invalid'> {
    const db = await openDb();
    const tx = db.transaction(META_STORE_NAME, 'readonly');
    const meta = await awaitRequest(tx.objectStore(META_STORE_NAME).get(id) as IDBRequest<BufferMeta | undefined>);
    await awaitTransaction(tx);
    return readPreparedBufferOwner(meta);
}

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Refresh a buffer's last-access stamp. The age-based collector deletes on
 * this field, so a silently failed refresh eventually deletes audio a project
 * still references — the reason it is observed rather than fire-and-forget.
 *
 * The write lands on the metadata row, so it costs 62 bytes rather than the
 * whole record. The transaction is scoped to both stores even though the steady
 * state only touches one, because whether the record has to be read is not
 * known until the metadata row has been read, and an IndexedDB transaction's
 * scope is fixed at creation (IDB 3.0 §3.1.7). Scope is not payload: the extra
 * store in scope blocks overlapping writers for the microseconds this takes,
 * while reading the record would move megabytes.
 *
 * The `else` branch is the v1 -> v2 migration, one id at a time on the path
 * that proves the id is in use. It reads the record once — the only PCM read on
 * this path, and it happens at most once per id per record lifetime — to
 * recover the `sizeInBytes` the size collector needs, then never again.
 *
 * Holding both stores in one transaction is also what stops this seeding a row
 * for a record that is being deleted. Overlapping-scope "readwrite"
 * transactions are ordered by creation across the database (IDB 3.0 §2.7.2), so
 * a `removeFromIdb` either commits first — and then both the row and the record
 * read back absent here, and nothing is written — or commits after, and takes
 * the row with it. No orphan row can exist in the gap, because there is no gap:
 * every read and write on this path is in the transaction below. The same is
 * true of the migration sweep in `garbageCollectByAge`. */
async function updateAccessTimeInIdb(id: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
    const metaStore = tx.objectStore(META_STORE_NAME);
    const meta = await awaitRequest(metaStore.get(id) as IDBRequest<BufferMeta | undefined>);
    if (meta) {
        metaStore.put({ ...meta, lastAccessed: Date.now() } satisfies BufferMeta, id);
    } else {
        const record = await awaitRequest(
            tx.objectStore(STORE_NAME).get(id) as IDBRequest<SerializedBuffer | undefined>
        );
        if (record) {
            metaStore.put(
                { lastAccessed: Date.now(), sizeInBytes: recordSizeInBytes(record) } satisfies BufferMeta,
                id
            );
        }
    }
    await awaitTransaction(tx);
}

/** The record's persisted `sizeInBytes`, or the same total recomputed from the
 * channels when the field is missing. A record written by a build older than
 * the field would otherwise seed a metadata row claiming zero bytes, and the
 * size collector would then evict everything else before touching it. */
function recordSizeInBytes(record: SerializedBuffer): number {
    if (typeof record.sizeInBytes === 'number' && Number.isFinite(record.sizeInBytes)) {
        return record.sizeInBytes;
    }
    return record.channelData.reduce((total, channel) => total + channel.byteLength, 0);
}

/** How much PCM one `garbageCollectByAge` pass may read to migrate records that
 * predate the metadata store.
 *
 * A record's size cannot be learned without reading it — IndexedDB has no
 * partial read — so the migration of a legacy store costs one read per record,
 * once, and the only question is how much of it happens at a time. Budgeting
 * *bytes* rather than records is what makes that bound hold: a count budget is
 * meaningless when one record can be a 69 MB freeze bounce and the next 4 KB.
 * At most one record overshoots, because the budget is checked before each
 * read and a record's size is only known after it. */
const LEGACY_MIGRATION_BYTE_BUDGET = 64 * 1024 * 1024;

/** Coalesce access-time refreshes (audit M-045). Holding one connection stops
 * the read path opening connections, but each read still ran its own readwrite
 * get+put transaction on the object store buffer persistence uses — measured in
 * `audioBufferCacheConnectionChurn.spec.ts`: one persist plus ten reads opened
 * eleven readwrite transactions, and now opens one, because `set()` seeds the
 * stamp from the record it writes and every read inside the window is free.
 *
 * The stamp only has to be accurate enough for the consumer that reads it, and
 * the age-based collector thinks in days (`garbageCollectByAge(maxAgeDays)`),
 * so one committed stamp per window per id keeps it exactly as honest. The
 * window is fixed, not sliding: skipped reads do not move the stamp, so a
 * buffer under continuous access still commits a fresh stamp once per window
 * rather than going quiet. A failed refresh keeps its stamp — it is retried
 * next window, and logged either way. */
const ACCESS_REFRESH_WINDOW_MS = 60_000;
const accessRefreshStampById = new Map<string, number>();

function refreshAccessTime(id: string): void {
    if (versionChangeLatched) {
        // The stamp has nowhere to go and will not for the life of the page.
        // Without this the refresh keeps calling a permanently-rejecting
        // `openDb()`, logging one warning per resident id per window forever.
        return;
    }
    const now = Date.now();
    const lastRefreshedAt = accessRefreshStampById.get(id);
    if (lastRefreshedAt !== undefined && now - lastRefreshedAt < ACCESS_REFRESH_WINDOW_MS) {
        return;
    }
    accessRefreshStampById.set(id, now);
    updateAccessTimeInIdb(id).catch((error: unknown) => {
        logger.warn('[audioBufferCache] Audio buffer access-time refresh failed', { id, error });
    });
}

async function persistSerializedToIdb(id: string, data: SerializedBuffer, freezeProjectId?: number): Promise<boolean> {
    const generation = claimPersistenceGeneration(id);
    try {
        const db = await openDb();
        if (persistenceGenerationById.get(id) !== generation) {
            return false;
        }
        // One transaction over both stores. Two transactions would let the
        // record commit while its metadata row rolled back (or the reverse),
        // and a `sizeInBytes` total that disagrees with the records is a size
        // collector evicting the wrong things or nothing at all.
        const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
        tx.objectStore(STORE_NAME).put(data, id);
        const metadata: BufferMeta = { lastAccessed: data.lastAccessed, sizeInBytes: data.sizeInBytes };
        if (freezeProjectId !== undefined) {
            metadata.freezeProjectId = freezeProjectId;
        }
        tx.objectStore(META_STORE_NAME).put(metadata, id);
        await awaitTransaction(tx);
        return true;
    } catch (error) {
        logger.warn('[audioBufferCache] Audio buffer persistence failed', { id, error });
        return false;
    } finally {
        if (persistenceGenerationById.get(id) === generation) {
            persistenceGenerationById.delete(id);
        }
    }
}

async function removeFromIdb(id: string): Promise<void> {
    const generation = claimPersistenceGeneration(id);
    try {
        const db = await openDb();
        if (persistenceGenerationById.get(id) !== generation) {
            return;
        }
        // Both rows under one transaction: a metadata row that outlived its
        // record keeps counting bytes that are no longer there.
        const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.objectStore(META_STORE_NAME).delete(id);
        await awaitTransaction(tx);
    } catch (error) {
        logger.warn('[audioBufferCache] Audio buffer removal failed', { id, error });
    } finally {
        if (persistenceGenerationById.get(id) === generation) {
            persistenceGenerationById.delete(id);
        }
    }
}

const mipmapLevel1Cache = new Map<string, Float32Array>();

function clearWaveformCachesForId(id: string) {
    mipmapLevel1Cache.delete(id);
    for (const key of waveformCache.keys()) {
        if (key.startsWith(`${id}:`)) {
            waveformCache.delete(key);
        }
    }
}

/** Drop every in-memory trace of one buffer id: the decoded buffer, its
 * waveform and mipmap caches, and its access-refresh stamp.
 *
 * The stamp has to go with the rest (audit M-045). It is keyed by id and
 * nothing else prunes it, so leaving it behind retains an entry per buffer the
 * cache no longer holds, and — because the window is fixed rather than sliding
 * — it also suppresses the first refresh for up to a window if the same id
 * comes back. Every site that drops a buffer *by id* goes through here: LRU
 * eviction, the pinned-set rebuild, and all three collectors.
 *
 * `clear()` is the exception and stays hand-written, because it drops
 * everything at once and empties each map rather than walking ids. It has to
 * empty `mipmapLevel1Cache` too — that is the map this helper reaches only
 * via `clearWaveformCachesForId`. */
function evictCachedBuffer(id: string): void {
    bumpBufferLifecycleEpoch(id);
    cache.delete(id);
    residentFreezeProjectIdById.delete(id);
    clearWaveformCachesForId(id);
    accessRefreshStampById.delete(id);
    if (!activeBufferReopenCountById.has(id) && !persistenceGenerationById.has(id)) {
        bufferLifecycleEpochById.delete(id);
    }
}

function clearRuntimeCacheState(): void {
    runtimeClearEpoch++;
    cache.clear();
    residentFreezeProjectIdById.clear();
    pinnedBufferIds.clear();
    waveformCache.clear();
    // The level-1 mipmap is keyed by id alone and is not bounded. Keeping it
    // across a project transition leaks memory and can draw the previous
    // project's peaks when the incoming project reuses an id.
    mipmapLevel1Cache.clear();
    accessRefreshStampById.clear();
    bufferLifecycleEpochById.clear();
}

type PreparedAudioBuffers = {
    publish: () => number;
};

type PreparedImportedAudioBuffers = PreparedAudioBuffers & {
    persist: () => Promise<boolean>;
};

type PrepareBuffersFromIdbInput = {
    context: Pick<BaseAudioContext, 'createBuffer'>;
    ids?: string[];
    shouldContinue?: () => boolean;
};

async function prepareBuffersFromIdb({
    context,
    ids,
    shouldContinue,
}: PrepareBuffersFromIdbInput): Promise<PreparedAudioBuffers | null> {
    const staged: Array<{ id: string; buffer: AudioBuffer }> = [];
    try {
        if (shouldContinue?.() === false) {
            return null;
        }
        const db = await openDb();
        if (shouldContinue?.() === false) {
            return null;
        }
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const keys: IDBValidKey[] =
            ids !== undefined
                ? ids.filter((id) => !cache.has(id))
                : await new Promise<IDBValidKey[]>((resolve, reject) => {
                      const request = store.getAllKeys();
                      request.onsuccess = () => resolve(request.result);
                      request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
                  });

        for (const key of keys) {
            if (shouldContinue?.() === false) {
                return null;
            }
            if (typeof key !== 'string') {
                continue;
            }
            const id = key;
            if (cache.has(id)) {
                continue;
            }
            const data = await new Promise<SerializedBuffer | undefined>((resolve, reject) => {
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result as SerializedBuffer | undefined);
                request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
            });
            if (shouldContinue?.() === false) {
                return null;
            }
            const length = data?.channelData[0]?.length ?? 0;
            if (
                !data ||
                length === 0 ||
                data.channelData.length !== data.numberOfChannels ||
                data.channelData.some((channel) => channel.length !== length)
            ) {
                continue;
            }
            const buffer = context.createBuffer(data.numberOfChannels, length, data.sampleRate);
            for (let channel = 0; channel < data.numberOfChannels; channel++) {
                buffer.getChannelData(channel).set(data.channelData[channel]!);
            }
            staged.push({ id, buffer });
        }
    } catch {
        return {
            publish: () => {
                if (ids) {
                    replacePinnedBufferIds(ids);
                }
                return 0;
            },
        };
    }

    let published = false;
    return {
        publish: () => {
            if (published) {
                return 0;
            }
            published = true;
            if (ids) {
                replacePinnedBufferIds(ids);
            }
            for (const { id, buffer } of staged) {
                audioCacheSet(id, buffer);
            }
            return staged.length;
        },
    };
}

type GarbageCollectFreezeFilesInput = {
    activeIds: Set<string>;
    projectId: number;
};

type AudioBufferCacheSetOptions = {
    freezeProjectId?: number;
};

type AudioBufferCacheClearRuntimeOptions = {
    retainedIds?: Iterable<string>;
};

type PersistPreparedBufferInput = {
    id: string;
    buffer: AudioBuffer;
};

type ReopenPreparedBufferInput = {
    id: string;
    leaseId: string;
    context: Pick<BaseAudioContext, 'createBuffer'>;
};

type ReleasePreparedBufferInput = {
    id: string;
    leaseId: string;
    disposition: 'discard' | 'project-owned';
};

/** Persist one collision-safe prepared owner, then publish its committed PCM for synchronous reads. */
async function persistPreparedBuffer({ id, buffer }: PersistPreparedBufferInput) {
    const leaseId = `prepared-audio-${crypto.randomUUID()}`;
    const data = serializeBuffer(buffer);
    const generation = claimPersistenceGeneration(id);
    const attempt = registerPreparedPersistenceAttempt(id, generation);
    bumpBufferLifecycleEpoch(id);
    try {
        const db = await openDb();
        if (persistenceGenerationById.get(id) !== generation) {
            return { status: 'failed' as const, reason: 'Prepared audio persistence was superseded.' };
        }
        const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const metaStore = tx.objectStore(META_STORE_NAME);
        const [existingData, existingMeta] = await Promise.all([
            awaitRequest(store.get(id) as IDBRequest<SerializedBuffer | undefined>),
            awaitRequest(metaStore.get(id) as IDBRequest<BufferMeta | undefined>),
        ]);
        const occupied = existingData !== undefined || existingMeta !== undefined;
        if (occupied && !isReplaceablePreparedBuffer(existingData, existingMeta)) {
            await awaitTransaction(tx);
            return { status: 'failed' as const, reason: 'Prepared audio buffer ID is already occupied.' };
        }
        store.put(data, id);
        metaStore.put(
            {
                lastAccessed: data.lastAccessed,
                preparedOwner: { schemaVersion: 1, leaseId, status: 'temporary' },
                sizeInBytes: data.sizeInBytes,
            } satisfies BufferMeta,
            id
        );
        await awaitTransaction(tx);
        if (persistenceGenerationById.get(id) !== generation) {
            await waitForSupersedingPreparedPersistence(id, generation);
            const owner = await readPreparedOwnerFromIdb(id);
            if (owner === 'invalid' || owner?.leaseId !== leaseId) {
                return { status: 'failed' as const, reason: 'Prepared audio persistence was superseded.' };
            }
        }
        audioCacheSet(id, buffer, undefined, true);
        clearWaveformCachesForId(id);
        accessRefreshStampById.set(id, data.lastAccessed);
        return { status: 'persisted' as const, bufferId: id, leaseId };
    } catch (error) {
        return { status: 'failed' as const, reason: failureReason(error) };
    } finally {
        attempt.settle();
        if (preparedPersistenceAttemptById.get(id) === attempt) {
            preparedPersistenceAttemptById.delete(id);
        }
        if (persistenceGenerationById.get(id) === generation) {
            persistenceGenerationById.delete(id);
        }
    }
}

/** Reconstruct one exact prepared owner without making every playback read async. */
async function reopenPreparedBuffer({ id, leaseId, context }: ReopenPreparedBufferInput) {
    const lifecycle = beginBufferReopen(id);
    try {
        const db = await openDb();
        const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readonly');
        const [data, meta] = await Promise.all([
            awaitRequest(tx.objectStore(STORE_NAME).get(id) as IDBRequest<SerializedBuffer | undefined>),
            awaitRequest(tx.objectStore(META_STORE_NAME).get(id) as IDBRequest<BufferMeta | undefined>),
        ]);
        await awaitTransaction(tx);
        if (!isBufferLifecycleCurrent(id, lifecycle)) {
            return { status: 'failed' as const, reason: 'Prepared audio reopen was superseded.' };
        }
        if (!data || !meta) {
            return { status: 'missing' as const };
        }
        const owner = readPreparedBufferOwner(meta);
        if (owner === 'invalid') {
            return { status: 'failed' as const, reason: 'Prepared audio ownership metadata is invalid.' };
        }
        if (!owner || owner.leaseId !== leaseId) {
            return { status: 'mismatched' as const };
        }
        if (!isValidSerializedBuffer(data)) {
            return { status: 'failed' as const, reason: 'Prepared audio PCM is invalid.' };
        }
        if (!Number.isFinite(meta.lastAccessed) || meta.sizeInBytes !== data.sizeInBytes) {
            return { status: 'failed' as const, reason: 'Prepared audio metadata does not match its PCM.' };
        }
        const length = data.channelData[0]!.length;
        const buffer = context.createBuffer(data.numberOfChannels, length, data.sampleRate);
        for (let channel = 0; channel < data.numberOfChannels; channel++) {
            buffer.getChannelData(channel).set(data.channelData[channel]!);
        }
        audioCacheSet(id, buffer, meta.freezeProjectId, true);
        clearWaveformCachesForId(id);
        accessRefreshStampById.set(id, meta.lastAccessed);
        return { status: 'reopened' as const, bufferId: id, ownership: owner.status };
    } catch (error) {
        return { status: 'failed' as const, reason: failureReason(error) };
    } finally {
        finishBufferReopen(id);
    }
}

/** Settle one temporary owner transactionally; project transfer retains PCM. */
async function releasePreparedBuffer({ id, leaseId, disposition }: ReleasePreparedBufferInput) {
    const generation = claimPersistenceGeneration(id);
    bumpBufferLifecycleEpoch(id);
    try {
        const db = await openDb();
        if (persistenceGenerationById.get(id) !== generation) {
            return { status: 'failed' as const, reason: 'Prepared audio settlement was superseded.' };
        }
        const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const metaStore = tx.objectStore(META_STORE_NAME);
        const [data, meta] = await Promise.all([
            awaitRequest(store.get(id) as IDBRequest<SerializedBuffer | undefined>),
            awaitRequest(metaStore.get(id) as IDBRequest<BufferMeta | undefined>),
        ]);
        if (!data || !meta) {
            await awaitTransaction(tx);
            return { status: 'missing' as const };
        }
        const owner = readPreparedBufferOwner(meta);
        if (owner === 'invalid') {
            await awaitTransaction(tx);
            return { status: 'failed' as const, reason: 'Prepared audio ownership metadata is invalid.' };
        }
        if (!owner || owner.leaseId !== leaseId) {
            await awaitTransaction(tx);
            return { status: 'mismatched' as const };
        }
        if (owner.status === 'project-owned') {
            await awaitTransaction(tx);
            return { status: 'already-settled' as const, disposition: 'project-owned' as const };
        }
        if (disposition === 'project-owned') {
            if (!isValidSerializedBuffer(data) || meta.sizeInBytes !== data.sizeInBytes) {
                await awaitTransaction(tx);
                return { status: 'failed' as const, reason: 'Prepared audio PCM cannot be promoted safely.' };
            }
            metaStore.put({ ...meta, preparedOwner: { ...owner, status: 'project-owned' } } satisfies BufferMeta, id);
            await awaitTransaction(tx);
            return { status: 'released' as const, disposition: 'project-owned' as const };
        }
        store.delete(id);
        metaStore.delete(id);
        await awaitTransaction(tx);
        evictCachedBuffer(id);
        return { status: 'released' as const, disposition: 'discarded' as const };
    } catch (error) {
        return { status: 'failed' as const, reason: failureReason(error) };
    } finally {
        if (persistenceGenerationById.get(id) === generation) {
            persistenceGenerationById.delete(id);
        }
    }
}

export function clearRuntimeAudioBufferCache({ retainedIds }: AudioBufferCacheClearRuntimeOptions = {}): void {
    if (!retainedIds) {
        clearRuntimeCacheState();
        return;
    }
    const retainedIdSet = new Set(retainedIds);
    for (const id of cache.keys()) {
        if (!retainedIdSet.has(id)) {
            evictCachedBuffer(id);
        }
    }
    pinnedBufferIds.clear();
}

export const audioBufferCache = {
    get(id: string): AudioBuffer | undefined {
        const buf = audioCacheGet(id);
        if (buf) {
            refreshAccessTime(id);
        }
        return buf;
    },

    set(id: string, buffer: AudioBuffer, { freezeProjectId }: AudioBufferCacheSetOptions = {}): void {
        audioCacheSet(id, buffer, freezeProjectId, true);
        clearWaveformCachesForId(id);
        const data = serializeBuffer(buffer);
        // Seed the coalescing stamp from the record being written (audit M-045).
        // The persisted `lastAccessed` *is* a fresh access stamp, so without
        // this the first read after every persist spends a whole readwrite
        // get+put transaction rewriting a timestamp that is already current.
        accessRefreshStampById.set(id, data.lastAccessed);
        void persistSerializedToIdb(id, data, freezeProjectId);
    },

    remove(id: string): void {
        pinnedBufferIds.delete(id);
        evictCachedBuffer(id);
        void removeFromIdb(id);
    },

    has(id: string): boolean {
        return cache.has(id);
    },

    persistPreparedBuffer,

    reopenPreparedBuffer,

    releasePreparedBuffer,

    getWaveformPeaks(
        id: string,
        numBins: number,
        windowOpts?: { startSample?: number; endSample?: number }
    ): Float32Array {
        if (numBins <= 0) {
            return new Float32Array(0);
        }

        const buffer = cache.get(id);
        if (!buffer) {
            return new Float32Array(numBins);
        }

        // Runs before the waveform-cache hit on purpose: a fully cached peak
        // read is still a use of the buffer, and the age-based collector must
        // see it. Coalescing (audit M-045) makes this at most one committed
        // stamp per window per id, not one readwrite transaction per paint.
        refreshAccessTime(id);
        const totalSamples = buffer.length;
        const rawStart = windowOpts?.startSample ?? 0;
        const rawEnd = windowOpts?.endSample ?? totalSamples;
        const windowStart = Math.max(0, Math.min(totalSamples, Math.floor(rawStart)));
        const windowEnd = Math.max(windowStart, Math.min(totalSamples, Math.floor(rawEnd)));
        const windowLength = windowEnd - windowStart;

        // Cache key includes the window so trimmed / offset clips don't collide
        // with full-buffer peaks.
        const key = `${id}:${numBins}:${windowStart}:${windowEnd}`;
        const cached = waveformCache.get(key);
        if (cached) {
            return cached;
        }

        if (windowLength <= 0) {
            const empty = new Float32Array(numBins);
            waveformCacheSet(key, empty);
            return empty;
        }

        const channelData = buffer.getChannelData(0);
        const peaks = new Float32Array(numBins);
        const samplesPerBin = windowLength / numBins;

        if (samplesPerBin >= 256) {
            // Use Mipmap Level 1 — cached at 256-sample resolution over the
            // entire buffer. We sub-range into it by windowStart/windowEnd.
            let mipmap = mipmapLevel1Cache.get(id);
            if (!mipmap) {
                const mipmapLength = Math.ceil(channelData.length / 256);
                mipmap = new Float32Array(mipmapLength);
                for (let index = 0; index < mipmapLength; index++) {
                    let peak = 0;
                    const start = index * 256;
                    const end = Math.min(start + 256, channelData.length);
                    for (let jIndex = start; jIndex < end; jIndex++) {
                        const abs = Math.abs(channelData[jIndex]!);
                        if (abs > peak) {
                            peak = abs;
                        }
                    }
                    mipmap[index] = peak;
                }
                mipmapLevel1Cache.set(id, mipmap);
            }

            const mipmapWindowStart = windowStart / 256;
            const mipmapWindowEnd = Math.min(windowEnd / 256, mipmap.length);
            const mipmapWindowLen = Math.max(0, mipmapWindowEnd - mipmapWindowStart);
            const mipmapSamplesPerBin = mipmapWindowLen / numBins;
            for (let bin = 0; bin < numBins; bin++) {
                let peak = 0;
                const start = Math.floor(mipmapWindowStart + bin * mipmapSamplesPerBin);
                const end = Math.floor(Math.min(mipmapWindowStart + (bin + 1) * mipmapSamplesPerBin, mipmap.length));
                if (start === end) {
                    peak = mipmap[start] || 0;
                } else {
                    for (let index = start; index < end; index++) {
                        const value = mipmap[index]!;
                        if (value > peak) {
                            peak = value;
                        }
                    }
                }
                peaks[bin] = peak;
            }
        } else {
            // High zoom: read directly from the windowed portion of the buffer.
            for (let bin = 0; bin < numBins; bin++) {
                let peak = 0;
                const start = Math.floor(windowStart + bin * samplesPerBin);
                const end = Math.floor(Math.min(windowStart + (bin + 1) * samplesPerBin, windowEnd));
                if (start === end) {
                    peak = Math.abs(channelData[start] || 0);
                } else {
                    for (let index = start; index < end; index++) {
                        const abs = Math.abs(channelData[index]!);
                        if (abs > peak) {
                            peak = abs;
                        }
                    }
                }
                peaks[bin] = peak;
            }
        }

        waveformCacheSet(key, peaks);
        return peaks;
    },

    async restoreFromIdb({
        context,
        ids,
        shouldContinue,
    }: {
        context: Pick<BaseAudioContext, 'createBuffer'>;
        ids?: string[];
        shouldContinue?: () => boolean;
    }): Promise<number> {
        const prepared = await prepareBuffersFromIdb({ context, ids, shouldContinue });
        if (!prepared || shouldContinue?.() === false) {
            return 0;
        }
        return prepared.publish();
    },

    prepareFromIdb({
        context,
        ids,
        shouldContinue,
    }: {
        context: Pick<BaseAudioContext, 'createBuffer'>;
        ids?: string[];
        shouldContinue?: () => boolean;
    }): Promise<PreparedAudioBuffers | null> {
        return prepareBuffersFromIdb({ context, ids, shouldContinue });
    },

    clear(): void {
        cancelAllImportCandidates();
        clearRuntimeCacheState();
        persistenceGenerationById.clear();
        // Deliberately keeps the memoized connection (audit M-045). Clearing the
        // object store does not invalidate the connection, so dropping the memo
        // here would abandon the handle the clear is still running on: the clear
        // holds it alive to completion while every later caller opens a second
        // one, and the orphan then blocks any `versionchange` for the life of
        // the page. That leak is the whole reason, and it is sufficient on its
        // own.
        //
        // Ordering is *not* part of the reason, whatever an earlier draft of
        // this comment claimed. IDB 3.0 §2.7.2 orders overlapping-scope
        // "readwrite" transactions by creation order across the *database* —
        // there is no same-connection qualifier — so a `clear()` and a `set()`
        // right after it commit in that order even on two connections.
        openDb()
            .then(async (db) => {
                const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
                tx.objectStore(STORE_NAME).clear();
                // Metadata rows left behind here would keep every buffer of the
                // previous project counting against the 2 GiB size cap, and the
                // size collector would evict live audio to make room for them.
                tx.objectStore(META_STORE_NAME).clear();
                await awaitTransaction(tx);
                return null;
            })
            .catch((error: unknown) => {
                logger.warn('[audioBufferCache] Audio buffer store clear failed', { error });
                return null;
            });
    },

    cancelPendingImport(): void {
        cancelPendingImportCandidate();
    },

    /** Serialize the given buffer IDs to base64-encoded PCM for embedding in a
     * .sourdaw project file. IDs not found in the in-memory cache are fetched
     * from IDB before serialization. IDs that cannot be resolved are silently
     * omitted from the result. */
    async exportBuffers(ids: string[]): Promise<Record<string, ExportedAudioBuffer>> {
        const result: Record<string, ExportedAudioBuffer> = {};
        const metadataById = new Map<string, BufferMeta>();
        try {
            const db = await openDb();
            const tx = db.transaction(META_STORE_NAME, 'readonly');
            const metaStore = tx.objectStore(META_STORE_NAME);
            const metadataRows = await Promise.all(
                ids.map((id) => awaitRequest(metaStore.get(id) as IDBRequest<BufferMeta | undefined>))
            );
            for (let index = 0; index < ids.length; index++) {
                const metadata = metadataRows[index];
                if (metadata) {
                    metadataById.set(ids[index]!, metadata);
                }
            }
        } catch (error) {
            logger.warn('[audioBufferCache] Export could not read buffer metadata from IndexedDB', { ids, error });
        }

        // Pass 1: serialize buffers already in the in-memory cache
        for (const id of ids) {
            const buf = cache.get(id);
            if (!buf) {
                continue;
            }
            refreshAccessTime(id);
            const exported: ExportedAudioBuffer = {
                sampleRate: buf.sampleRate,
                numberOfChannels: buf.numberOfChannels,
                channelData: await Promise.all(
                    Array.from({ length: buf.numberOfChannels }, (_, ch) =>
                        float32ToBase64(new Float32Array(buf.getChannelData(ch)))
                    )
                ),
            };
            let freezeProjectId = metadataById.get(id)?.freezeProjectId;
            if (residentFreezeProjectIdById.has(id)) {
                freezeProjectId = residentFreezeProjectIdById.get(id);
            }
            if (freezeProjectId !== undefined) {
                exported.freezeProjectId = freezeProjectId;
            }
            result[id] = exported;
        }

        // Pass 2: for IDs evicted from the LRU cache, read SerializedBuffer
        // directly from IDB and encode without reconstructing an AudioBuffer
        // (which would require an AudioContext we may not have here).
        const missingIds = ids.filter((id) => !(id in result));
        if (missingIds.length > 0) {
            try {
                const db = await openDb();
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                for (const id of missingIds) {
                    const data = await new Promise<SerializedBuffer | undefined>((resolve, reject) => {
                        const req = store.get(id);
                        req.onsuccess = () => resolve(req.result as SerializedBuffer | undefined);
                        req.onerror = () => reject(req.error ?? new Error('IDB request failed'));
                    });
                    if (!data || (data.channelData[0]?.length ?? 0) === 0) {
                        continue;
                    }
                    refreshAccessTime(id);
                    const exported: ExportedAudioBuffer = {
                        sampleRate: data.sampleRate,
                        numberOfChannels: data.numberOfChannels,
                        channelData: await Promise.all(data.channelData.map(float32ToBase64)),
                    };
                    const freezeProjectId = metadataById.get(id)?.freezeProjectId;
                    if (freezeProjectId !== undefined) {
                        exported.freezeProjectId = freezeProjectId;
                    }
                    result[id] = exported;
                }
            } catch (error) {
                // IDB unreachable, so every id the LRU had evicted is absent
                // from the result and the caller writes a project file short of
                // that PCM. `buildProjectData` counts the gap and
                // `exportProjectFile` warns the user, but the cache layer must
                // say so too — under the `versionchange` latch this is
                // permanent rather than transient, and a silent catch here is
                // the only trace.
                logger.warn('[audioBufferCache] Export could not read evicted buffers from IndexedDB', {
                    unresolvedIds: missingIds.filter((id) => !(id in result)),
                    error,
                });
            }
        }

        return result;
    },

    /** Take authoritative incoming buffers without publishing them. The caller
     * owns the final synchronous project-transition commit.
     *
     * `buffers` carries base64 PCM read back out of a `.sourdaw` file — the one
     * place that shape still exists. `decodedBuffers` carries AudioBuffers a
     * caller already decoded (the DAWproject importer decodes its assets with
     * `decodeAudioData`), so nothing on that path is encoded just to be decoded
     * again a few frames later. */
    importBuffers({
        buffers,
        decodedBuffers,
        cacheIds,
        context,
        shouldContinue,
    }: {
        buffers: Record<string, ExportedAudioBuffer>;
        decodedBuffers?: Record<string, AudioBuffer>;
        cacheIds?: string[];
        context: BaseAudioContext;
        shouldContinue?: () => boolean;
    }): PreparedImportedAudioBuffers | null {
        const candidateId = ++nextImportCandidateId;
        activeImportCandidateId = candidateId;
        const staged: Array<{ id: string; buffer: AudioBuffer }> = [];
        const cacheIdSet = cacheIds ? new Set(cacheIds) : undefined;

        // One entry list over both sources. `readChannels` stays lazy so a
        // buffer the active arrangement does not reference is never decoded
        // before the persistence transaction needs it.
        type ImportEntry = {
            id: string;
            sampleRate: number;
            numberOfChannels: number;
            freezeProjectId?: number;
            resident: AudioBuffer | null;
            readChannels: () => Float32Array[];
        };
        const entries: ImportEntry[] = [];

        for (const [id, data] of Object.entries(buffers)) {
            if (shouldContinue?.() === false) {
                return null;
            }
            if (!isValidExportedAudioBuffer(data)) {
                return null;
            }
            entries.push({
                id,
                sampleRate: data.sampleRate,
                numberOfChannels: data.numberOfChannels,
                freezeProjectId: data.freezeProjectId,
                resident: null,
                readChannels: () => data.channelData.map(base64ToFloat32),
            });
        }

        for (const [id, buffer] of Object.entries(decodedBuffers ?? {})) {
            if (shouldContinue?.() === false) {
                return null;
            }
            if (buffer.numberOfChannels <= 0 || buffer.length <= 0) {
                return null;
            }
            entries.push({
                id,
                sampleRate: buffer.sampleRate,
                numberOfChannels: buffer.numberOfChannels,
                resident: buffer,
                readChannels: () =>
                    Array.from(
                        { length: buffer.numberOfChannels },
                        (_, channel) => new Float32Array(buffer.getChannelData(channel))
                    ),
            });
        }

        if (shouldContinue?.() === false) {
            return null;
        }

        for (const entry of entries) {
            if (cacheIdSet && !cacheIdSet.has(entry.id)) {
                continue;
            }
            if (entry.resident) {
                staged.push({ id: entry.id, buffer: entry.resident });
                continue;
            }
            const channels = entry.readChannels();
            const buffer = context.createBuffer(entry.numberOfChannels, channels[0]!.length, entry.sampleRate);
            for (let channel = 0; channel < entry.numberOfChannels; channel++) {
                buffer.getChannelData(channel).set(channels[channel]!);
            }
            staged.push({ id: entry.id, buffer });
        }
        const importedOwners = new Map(entries.map(({ id, freezeProjectId }) => [id, freezeProjectId]));

        let persisted = false;
        let published = false;
        return {
            persist: async () => {
                if (persisted) {
                    return true;
                }
                if (
                    !published ||
                    candidateId !== activeImportCandidateId ||
                    candidateId !== committedImportCandidateId
                ) {
                    return false;
                }
                if (entries.length === 0) {
                    persisted = true;
                    return true;
                }
                const generations = new Map<string, number>();
                for (const { id } of entries) {
                    generations.set(id, claimPersistenceGeneration(id));
                }
                let transaction: IDBTransaction | null = null;
                try {
                    let database: IDBDatabase;
                    try {
                        database = await openDb();
                    } catch {
                        const allBuffersAreResident = entries.every(
                            ({ id }) => cacheIdSet === undefined || cacheIdSet.has(id)
                        );
                        persisted = allBuffersAreResident;
                        return allBuffersAreResident;
                    }
                    if (
                        candidateId !== activeImportCandidateId ||
                        candidateId !== committedImportCandidateId ||
                        [...generations].some(([id, generation]) => persistenceGenerationById.get(id) !== generation)
                    ) {
                        return false;
                    }

                    const activeTransaction = database.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
                    transaction = activeTransaction;
                    importPersistenceTransactions.set(candidateId, activeTransaction);
                    const objectStore = activeTransaction.objectStore(STORE_NAME);
                    const metaStore = activeTransaction.objectStore(META_STORE_NAME);
                    for (const entry of entries) {
                        const channels = entry.readChannels();
                        const lastAccessed = Date.now();
                        const sizeInBytes = channels.reduce((total, channel) => total + channel.byteLength, 0);
                        objectStore.put(
                            {
                                sampleRate: entry.sampleRate,
                                numberOfChannels: entry.numberOfChannels,
                                channelData: channels,
                                lastAccessed,
                                sizeInBytes,
                            } satisfies SerializedBuffer,
                            entry.id
                        );
                        // Same transaction as the record, so an aborted import
                        // — which `abortImportPersistenceExcept` does routinely
                        // when a later candidate wins — leaves neither behind.
                        const metadata: BufferMeta = { lastAccessed, sizeInBytes };
                        if (entry.freezeProjectId !== undefined) {
                            metadata.freezeProjectId = entry.freezeProjectId;
                        }
                        metaStore.put(metadata, entry.id);
                    }
                    await awaitTransaction(activeTransaction);
                    if (candidateId !== activeImportCandidateId || candidateId !== committedImportCandidateId) {
                        return false;
                    }
                    persisted = true;
                    return true;
                } catch {
                    return false;
                } finally {
                    for (const [id, generation] of generations) {
                        if (persistenceGenerationById.get(id) === generation) {
                            persistenceGenerationById.delete(id);
                        }
                    }
                    if (transaction && importPersistenceTransactions.get(candidateId) === transaction) {
                        importPersistenceTransactions.delete(candidateId);
                    }
                }
            },
            publish: () => {
                if (published || candidateId !== activeImportCandidateId || shouldContinue?.() === false) {
                    return 0;
                }
                published = true;
                committedImportCandidateId = candidateId;
                abortImportPersistenceExcept(candidateId);
                if (cacheIds) {
                    replacePinnedBufferIds(cacheIds);
                }
                for (const { id, buffer } of staged) {
                    clearWaveformCachesForId(id);
                    audioCacheSet(id, buffer, importedOwners.get(id), true);
                }
                return staged.length;
            },
        };
    },

    async garbageCollectFreezeFiles({ activeIds, projectId }: GarbageCollectFreezeFilesInput): Promise<void> {
        try {
            const db = await openDb();
            const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const metaStore = tx.objectStore(META_STORE_NAME);
            const [metadataRows, metadataKeys] = await Promise.all([
                awaitRequest(metaStore.getAll() as IDBRequest<BufferMeta[]>),
                awaitRequest(metaStore.getAllKeys()),
            ]);
            const collectedKeys = new Set<string>();
            for (let index = 0; index < metadataKeys.length; index++) {
                const key = metadataKeys[index];
                const metadata = metadataRows[index];
                let freezeProjectId = metadata?.freezeProjectId;
                if (typeof key === 'string' && residentFreezeProjectIdById.has(key)) {
                    freezeProjectId = residentFreezeProjectIdById.get(key);
                }
                if (
                    typeof key !== 'string' ||
                    !key.startsWith('freeze-') ||
                    activeIds.has(key) ||
                    metadata?.preparedOwner?.status === 'temporary' ||
                    freezeProjectId !== projectId
                ) {
                    continue;
                }
                collectedKeys.add(key);
            }
            for (const [key, freezeProjectId] of residentFreezeProjectIdById) {
                if (key.startsWith('freeze-') && !activeIds.has(key) && freezeProjectId === projectId) {
                    collectedKeys.add(key);
                }
            }
            for (const key of collectedKeys) {
                store.delete(key);
                metaStore.delete(key);
            }
            await awaitTransaction(tx);
            for (const key of collectedKeys) {
                evictCachedBuffer(key);
            }
        } catch (error) {
            logger.warn('[audioBufferCache] Freeze-file collection failed', { error });
        }
    },

    async garbageCollectByAge(maxAgeDays: number): Promise<number> {
        const threshold = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
        let deletedCount = 0;
        try {
            const db = await openDb();
            const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const metaStore = tx.objectStore(META_STORE_NAME);
            // Reads the metadata store, not the records: the two numbers this
            // loop wants are 16 bytes each, and `getAll()` on the records
            // materialised every buffer in a store capped at 2 GiB to find
            // them.
            //
            // The invariant is **never collect on a stamp we do not have** —
            // not "never collect without a metadata row". The v1 code read
            // `item.lastAccessed ?? 0`, which *invented* a stamp: an absent one
            // read as the epoch and the record was deleted on the spot. That
            // fallback is gone rather than moved. What replaces it is reading
            // the real value, from the row where there is one and from the
            // record where there is not.
            const [metas, keys, recordKeys] = await Promise.all([
                awaitRequest(metaStore.getAll() as IDBRequest<BufferMeta[]>),
                awaitRequest(metaStore.getAllKeys()),
                awaitRequest(store.getAllKeys()),
            ]);

            const migratedIds = new Set<IDBValidKey>(keys);
            for (let index = 0; index < metas.length; index++) {
                const meta = metas[index]!;
                const key = keys[index]! as string;
                if (pinnedBufferIds.has(key) || meta.preparedOwner?.status === 'temporary') {
                    continue;
                }
                if (typeof meta.lastAccessed !== 'number') {
                    continue;
                }
                if (meta.lastAccessed < threshold) {
                    store.delete(key);
                    metaStore.delete(key);
                    evictCachedBuffer(key);
                    deletedCount++;
                }
            }

            // Records that predate the metadata store. This is the only place
            // that reliably sees them: `set` and the import write a row with
            // every new record, and `updateAccessTimeInIdb` seeds one for any id
            // a read touches — but a record whose clip was deleted without an
            // explicit `remove` is referenced by no project, so nothing ever
            // reads it.
            //
            // `restoreFromIdb` cannot be relied on either. It walks every key
            // only when `ids` is undefined, and the two use-case callers always
            // pass a list; the one caller that can omit it is `ExportDialog`,
            // and only when the project has no clips referencing a buffer at
            // all. So the ids it sees are, in every case that matters, ones
            // some project still holds — the exact complement of this set.
            //
            // Left unmigrated such a record would be immortal — never
            // age-collectable, and invisible to `garbageCollectBySize`'s total,
            // so the 2 GiB budget would be computed over a store arbitrarily
            // larger than it. v1 reaped these after `maxAgeDays` and so must
            // this. Reading the record is the only way to recover its stamp and
            // size, so the pass reads within a byte budget and converges over
            // successive cleanups rather than doing it all at once. Same
            // transaction as the reads above, so no window exists in which a
            // row can outlive the record it describes.
            let migrationBytes = 0;
            for (const key of recordKeys) {
                if (migrationBytes >= LEGACY_MIGRATION_BYTE_BUDGET) {
                    break;
                }
                if (typeof key !== 'string' || migratedIds.has(key)) {
                    continue;
                }
                const record = await awaitRequest(store.get(key) as IDBRequest<SerializedBuffer | undefined>);
                if (!record) {
                    continue;
                }
                const sizeInBytes = recordSizeInBytes(record);
                migrationBytes += sizeInBytes;
                if (typeof record.lastAccessed !== 'number') {
                    // Neither the row nor the record carries a stamp. Records
                    // written before `lastAccessed` existed are real — the
                    // original `SerializedBuffer` was `{sampleRate,
                    // numberOfChannels, channelData}` and nothing else.
                    //
                    // The clock starts now. That cannot advance a collection:
                    // `Date.now()` is the furthest-future stamp available, so
                    // the record becomes collectable `maxAgeDays` from this
                    // pass and never sooner. The invariant is that a record is
                    // never deleted on a stamp that was invented, and nothing
                    // here deletes.
                    //
                    // Leaving the row unwritten is what would be unsafe, and
                    // not for the obvious reason: the record would charge the
                    // byte budget on this pass, never retire from the sweep,
                    // and charge it again on every pass after — starving every
                    // record behind it out of the migration for as long as it
                    // exists. Those records would then stay out of
                    // `garbageCollectBySize`'s total, which is the 2 GiB
                    // residual this sweep was written to close.
                    metaStore.put({ lastAccessed: Date.now(), sizeInBytes } satisfies BufferMeta, key);
                    continue;
                }
                if (!pinnedBufferIds.has(key) && record.lastAccessed < threshold) {
                    store.delete(key);
                    evictCachedBuffer(key);
                    deletedCount++;
                    continue;
                }
                metaStore.put({ lastAccessed: record.lastAccessed, sizeInBytes } satisfies BufferMeta, key);
            }

            // The count is reported only for deletes that committed.
            await awaitTransaction(tx);
        } catch (error) {
            logger.warn('[audioBufferCache] Age-based collection failed', { error });
            return 0;
        }
        return deletedCount;
    },

    async garbageCollectBySize(maxSizeBytes: number): Promise<number> {
        let deletedCount = 0;
        try {
            const db = await openDb();
            const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const metaStore = tx.objectStore(META_STORE_NAME);
            // Metadata rows, for the same reason as `garbageCollectByAge`, and
            // with the same consequence: a record with no row is neither a
            // deletion candidate nor part of `currentTotal`.
            //
            // This collector does not sweep for un-migrated records itself.
            // `cleanupUnusedFreezeFiles` runs `garbageCollectByAge` immediately
            // before it, and that pass seeds or reaps them, so by the time this
            // runs the rows exist for everything the budget reached. Doing the
            // sweep in both would double the migration read for no gain.
            //
            // Until then those records are out of the total, so this collector
            // evicts *less* than it should. That is the direction to be wrong
            // in — the alternative is counting a record whose size is unknown as
            // zero, which under-reports the total just as badly *and* makes it
            // a candidate that frees nothing when deleted, so the loop would
            // walk the whole store deleting audio without the total ever
            // falling.
            const [metas, keys] = await Promise.all([
                awaitRequest(metaStore.getAll() as IDBRequest<BufferMeta[]>),
                awaitRequest(metaStore.getAllKeys()),
            ]);

            // Sort by access time ascending (oldest first)
            const entries = metas
                .map((meta, index) => ({
                    id: keys[index]! as string,
                    lastAccessed: meta.lastAccessed,
                    temporary: meta.preparedOwner?.status === 'temporary',
                    size: meta.sizeInBytes,
                }))
                .filter((entry) => typeof entry.lastAccessed === 'number' && typeof entry.size === 'number')
                .sort((alpha, b) => alpha.lastAccessed - b.lastAccessed);

            let currentTotal = entries.reduce((acc, event) => acc + event.size, 0);

            for (const entry of entries) {
                if (currentTotal <= maxSizeBytes) {
                    break;
                }
                if (pinnedBufferIds.has(entry.id) || entry.temporary) {
                    continue;
                }
                store.delete(entry.id);
                metaStore.delete(entry.id);
                evictCachedBuffer(entry.id);
                currentTotal -= entry.size;
                deletedCount++;
            }
            // The count is reported only for deletes that committed.
            await awaitTransaction(tx);
        } catch (error) {
            logger.warn('[audioBufferCache] Size-based collection failed', { error });
            return 0;
        }
        return deletedCount;
    },
};
