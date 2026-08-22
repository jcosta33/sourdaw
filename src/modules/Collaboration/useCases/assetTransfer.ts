import { logger } from '#/infra/logger/appLogger';
import { base64ToBytes, bytesToBase64 } from '#/utils/base64';

import {
    ASSET_CHUNK_SIZE,
    ASSET_REQUEST_MAX_ATTEMPTS,
    ASSET_REQUEST_RETRY_COOLDOWN_MS,
    MAX_ASSET_CHUNK_SIZE,
    MAX_ASSET_MIME_LEN,
    MAX_ASSET_NAME_LEN,
    MAX_ASSET_SIZE,
    MAX_CONCURRENT_ASSET_RESPONSES_PER_PEER,
    MIN_ASSET_CHUNK_SIZE,
    type PeerId,
    type PeerMessage,
} from '../models/CollaborationTypes';
import { DOC_ID_ASSET } from '../models/SyncChannelConstants';
import {
    createDurableAssetRepository,
    type DurableAssetRepository,
    type PromoteStagedAssetResult,
    type ReleaseStagedAssetResult,
    type ReopenDurableAssetResult,
    type ReopenStagedAssetResult,
} from '../repositories/durableAssetRepository';
import { type PeerConnectionManager } from '../repositories/peerConnection';

/**
 * How long a solicited transfer may go without progress before it is abandoned.
 *
 * The window covers both stalls with the same clock: waiting for the manifest
 * after a request, and waiting for the next chunk once chunks are flowing. A
 * transfer that never completes must release its partial state rather than pin
 * it for the rest of the session — the receiver has no other signal that the
 * sending peer died mid-stream.
 */
export const ASSET_TRANSFER_STALL_TIMEOUT_MS = 30_000;

export type AssetManifest = {
    hash: string;
    size: number;
    chunkSize: number;
    chunkCount: number;
    name: string;
    mime: string;
};

type AssetControlMessage =
    | { type: 'asset.request'; hash: string; missingChunks: number[] }
    | { type: 'asset.manifest'; manifest: AssetManifest }
    | { type: 'asset.chunk'; hash: string; index: number; data: string };

type AssetTransferCallbacks = {
    onAssetAvailable: (hash: string) => void;
    onProgress: (hash: string, receivedChunks: number, totalChunks: number) => void;
    /**
     * A solicited transfer ended without producing the asset — rejected chunk,
     * failed integrity check, or a stall past
     * {@link ASSET_TRANSFER_STALL_TIMEOUT_MS}. By the time this fires the hash
     * is no longer outstanding and no longer in flight, so the receiver is free
     * to request it again.
     */
    onTransferFailed: (hash: string, reason: string) => void;
};

type LocalAssetEntry = {
    blob: Blob;
    name: string;
};

/**
 * Content-addressed asset transfer over WebRTC data channels.
 *
 * Assets are identified by BLAKE3 hash (or SHA-256 as fallback in browser).
 * Transfer is chunked with bitmap-based resume.
 */
export class AssetTransfer {
    private peerManager: PeerConnectionManager;
    private callbacks: AssetTransferCallbacks;
    private durableAssets: DurableAssetRepository;

    /** Disposable resident cache; IndexedDB owns durable bytes and leases. */
    private localAssets = new Map<string, LocalAssetEntry>();

    /** In-flight incoming transfers: hash → { chunks, received bitmap } */
    private incomingTransfers = new Map<
        string,
        {
            manifest: AssetManifest;
            chunks: Map<number, Uint8Array>;
            receivedBitmap: Set<number>;
        }
    >();

    /**
     * Hashes this peer has actively requested and has not yet resolved. A
     * manifest is only accepted if its hash is in this set, so a remote peer
     * cannot start (and grow) a transfer slot we never asked for
     * (unsolicited-manifest DoS).
     *
     * Membership lasts until the request reaches a terminal state — the asset
     * is assembled, or the transfer is aborted — not merely until a manifest is
     * chosen. Dropping it at manifest time reopened the unsolicited-manifest
     * hole the moment a transfer was abandoned, and left `requestAsset` with no
     * way to tell "already asked, still waiting" from "never asked".
     */
    private requestedHashes = new Set<string>();

    /**
     * Per-hash stall deadline. Armed when a hash is requested, re-armed on an
     * accepted manifest and on any chunk that added an index the transfer did
     * not already hold, so the timer measures time since the last observable
     * progress rather than total transfer duration. A re-delivered chunk is not
     * progress and deliberately does not restart it.
     */
    private stallTimers = new Map<string, ReturnType<typeof setTimeout>>();

    /**
     * Earliest wall-clock time each aborted hash may be re-requested.
     *
     * The scheduler calls `requestAsset` on every tick for every missing clip,
     * so the request path has no memory of its own; this is that memory. An
     * entry is written on abort and dropped once the asset resolves.
     */
    private retryNotBefore = new Map<string, number>();

    /** Aborted attempts per hash, counted toward {@link ASSET_REQUEST_MAX_ATTEMPTS}. */
    private failedAttempts = new Map<string, number>();

    /**
     * Hashes abandoned for the rest of the session after too many aborts. A
     * peer can write any string into `clip.assetHash`, so without a terminal
     * state a hash no peer holds re-broadcasts forever.
     */
    private abandonedHashes = new Set<string>();

    /**
     * Hashes this host is currently serving, per requesting peer.
     *
     * A request is cheap to send and expensive to answer, so identical requests
     * arriving while one is being served are dropped rather than served
     * concurrently, and the number of distinct assets one peer may pull at once
     * is capped.
     */
    private servingHashesByPeer = new Map<PeerId, Set<string>>();

    constructor(
        peerManager: PeerConnectionManager,
        callbacks: AssetTransferCallbacks,
        durableAssets: DurableAssetRepository = createDurableAssetRepository()
    ) {
        this.peerManager = peerManager;
        this.callbacks = callbacks;
        this.durableAssets = durableAssets;
    }

    /**
     * Drop every in-flight transfer, its partial chunks, and its stall timer.
     *
     * The session owner discards this instance on teardown; without an explicit
     * disposal the armed timers keep firing against a dead session and the
     * retained chunk buffers outlive it.
     */
    dispose(): void {
        for (const timer of this.stallTimers.values()) {
            clearTimeout(timer);
        }
        this.stallTimers.clear();
        this.incomingTransfers.clear();
        this.requestedHashes.clear();
        this.retryNotBefore.clear();
        this.failedAttempts.clear();
        this.abandonedHashes.clear();
        this.servingHashesByPeer.clear();
        this.localAssets.clear();
    }

    /** Register a local asset (e.g. after recording or importing). */
    async addLocalAsset(blob: Blob, name: string): Promise<string> {
        const stored = await this.durableAssets.storeDurableAsset(blob, name);
        this.localAssets.set(stored.hash, { blob: stored.blob, name: stored.name });
        return stored.hash;
    }

    /** Stage an import asset under a unique lease until project commit or cancellation. */
    async stageLocalAsset(blob: Blob, name: string): Promise<{ hash: string; leaseId: string }> {
        const staged = await this.durableAssets.stageAsset(blob, name);
        this.localAssets.set(staged.hash, { blob: staged.blob, name: staged.name });
        return { hash: staged.hash, leaseId: staged.leaseId };
    }

    /** Verify and reopen one exact staged original after owner recreation. */
    async reopenStagedAsset(leaseId: string, expectedHash: string): Promise<ReopenStagedAssetResult> {
        const result = await this.durableAssets.reopenStagedAsset(leaseId, expectedHash);
        if (result.status === 'opened') {
            this.localAssets.set(result.hash, { blob: result.blob, name: result.name });
        }
        return result;
    }

    /** Verify and reopen one project-owned original after owner recreation. */
    async reopenLocalAsset(hash: string): Promise<ReopenDurableAssetResult> {
        const result = await this.durableAssets.reopenDurableAsset(hash);
        if (result.status === 'opened') {
            this.localAssets.set(result.hash, { blob: result.blob, name: result.name });
        }
        return result;
    }

    /** Release one hash-bound staging reference exactly once. */
    async releaseStagedAsset(leaseId: string, expectedHash?: string): Promise<ReleaseStagedAssetResult> {
        const result = await this.durableAssets.releaseStagedAsset(leaseId, expectedHash);
        if (result.status !== 'failed' && result.assetRemoved) {
            this.localAssets.delete(result.hash);
        }
        return result;
    }

    /** Promote one hash-bound staging reference exactly once. */
    async promoteStagedAsset(leaseId: string, expectedHash?: string): Promise<PromoteStagedAssetResult> {
        const result = await this.durableAssets.promoteStagedAsset(leaseId, expectedHash);
        if (result.status !== 'failed') {
            this.localAssets.set(result.hash, { blob: result.blob, name: result.name });
        }
        return result;
    }

    /** Check if an asset is available locally. */
    hasAsset(hash: string): boolean {
        return this.localAssets.has(hash);
    }

    /** Get a local asset by hash. */
    getAsset(hash: string): Blob | undefined {
        return this.localAssets.get(hash)?.blob;
    }

    /**
     * Request a missing asset from connected peers.
     *
     * Idempotent while the request is alive: repeated calls for a hash that is
     * already held, already in flight, or still outstanding are dropped, so a
     * per-tick caller cannot flood the channel. Once a transfer aborts, the
     * hash becomes requestable again — that is what makes an interrupted asset
     * recoverable inside the same session — but only after
     * {@link ASSET_REQUEST_RETRY_COOLDOWN_MS}, and only for
     * {@link ASSET_REQUEST_MAX_ATTEMPTS} attempts in total. The caller is the
     * scheduler tick (~100/s), so this method owns the whole retry policy and
     * must stay a handful of lookups.
     */
    requestAsset(hash: string): void {
        if (this.localAssets.has(hash) || this.incomingTransfers.has(hash) || this.requestedHashes.has(hash)) {
            return;
        }
        if (this.abandonedHashes.has(hash)) {
            return;
        }
        const notBefore = this.retryNotBefore.get(hash);
        if (notBefore !== undefined && Date.now() < notBefore) {
            return;
        }

        // Mark the hash as outstanding so an incoming manifest for it is treated
        // as a solicited reply rather than an unsolicited transfer slot.
        this.requestedHashes.add(hash);
        this.armStallTimer(hash);

        const msg: AssetControlMessage = {
            type: 'asset.request',
            hash,
            missingChunks: [],
        };

        this.peerManager.broadcastCrdtSync({
            type: 'crdt-sync',
            docId: DOC_ID_ASSET,
            data: JSON.stringify(msg),
        });
    }

    /** Handle an incoming asset-related message. */
    async handleMessage(peerId: PeerId, message: PeerMessage): Promise<void> {
        if (message.type !== 'crdt-sync' || message.docId !== DOC_ID_ASSET) {
            return;
        }

        try {
            const data = JSON.parse(message.data) as AssetControlMessage;

            if (data.type === 'asset.request') {
                await this.handleAssetRequest(peerId, data.hash, data.missingChunks);
            } else if (data.type === 'asset.manifest') {
                this.handleManifest(peerId, data.manifest);
            } else if (data.type === 'asset.chunk') {
                this.handleChunk(data.hash, data.index, data.data);
            }
        } catch (error) {
            logger.warn('[AssetTransfer] Failed to handle message:', error);
        }
    }

    /** Arm (or re-arm) the no-progress deadline for one outstanding hash. */
    private armStallTimer(hash: string): void {
        this.clearStallTimer(hash);
        this.stallTimers.set(
            hash,
            setTimeout(() => {
                this.stallTimers.delete(hash);
                this.abortTransfer(hash, 'the sending peer stopped responding');
            }, ASSET_TRANSFER_STALL_TIMEOUT_MS)
        );
    }

    private clearStallTimer(hash: string): void {
        const timer = this.stallTimers.get(hash);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.stallTimers.delete(hash);
        }
    }

    /**
     * End a solicited transfer that cannot complete: release its partial chunks
     * and its outstanding marker, then report the failure.
     *
     * Releasing the marker is the recovery seam — the hash becomes requestable
     * again, so one hostile or dead first-responder no longer makes the asset
     * permanently unfetchable for the rest of the session. Reporting is the
     * user-facing seam: an abandoned transfer used to be a `logger.warn` and
     * nothing else, leaving clips silently unplayable.
     *
     * Recovery is rate-limited, not free: the abort arms a cooldown and spends
     * one of the hash's attempts. Its caller is the per-tick scheduler, so an
     * uncooled re-open turns every immediately-aborting failure class into a
     * request/abort loop at peer-RTT speed.
     */
    private abortTransfer(hash: string, reason: string): void {
        this.clearStallTimer(hash);
        const wasOutstanding = this.requestedHashes.delete(hash);
        const wasInFlight = this.incomingTransfers.delete(hash);
        if (!wasOutstanding && !wasInFlight) {
            return;
        }

        const attempts = (this.failedAttempts.get(hash) ?? 0) + 1;
        this.failedAttempts.set(hash, attempts);
        if (attempts >= ASSET_REQUEST_MAX_ATTEMPTS) {
            this.abandonedHashes.add(hash);
            this.retryNotBefore.delete(hash);
        } else {
            this.retryNotBefore.set(hash, Date.now() + ASSET_REQUEST_RETRY_COOLDOWN_MS);
        }

        logger.warn(`[AssetTransfer] Transfer for ${hash} aborted: ${reason}`);
        this.callbacks.onTransferFailed(hash, reason);
    }

    private async handleAssetRequest(peerId: PeerId, hash: string, missingChunks: unknown): Promise<void> {
        const entry = this.localAssets.get(hash);
        if (!entry) {
            return;
        }

        // A request is a ~100-byte message; answering one slices, base64-encodes
        // and buffers the whole asset. Without an in-flight marker, N identical
        // requests are served N times concurrently, so the responder multiplies
        // the sender's cost by N — a bound on any single response cannot help.
        // Identical requests are dropped while one is serving (the response the
        // peer is already receiving is the answer); distinct hashes are capped.
        const serving = this.servingHashesByPeer.get(peerId) ?? new Set<string>();
        if (serving.has(hash) || serving.size >= MAX_CONCURRENT_ASSET_RESPONSES_PER_PEER) {
            return;
        }
        serving.add(hash);
        this.servingHashesByPeer.set(peerId, serving);
        try {
            await this.sendAssetResponse(peerId, hash, entry, missingChunks);
        } finally {
            serving.delete(hash);
            if (serving.size === 0) {
                this.servingHashesByPeer.delete(peerId);
            }
        }
    }

    private async sendAssetResponse(
        peerId: PeerId,
        hash: string,
        entry: LocalAssetEntry,
        missingChunks: unknown
    ): Promise<void> {
        const { blob, name } = entry;
        const chunkCount = Math.ceil(blob.size / ASSET_CHUNK_SIZE);
        const manifest: AssetManifest = {
            hash,
            size: blob.size,
            chunkSize: ASSET_CHUNK_SIZE,
            chunkCount,
            name,
            mime: blob.type || 'application/octet-stream',
        };

        // The manifest must land before its chunks: a chunk for a hash with no
        // manifest is rejected by `handleChunk`.
        await this.peerManager.sendCrdtSync({
            peerId,
            message: {
                type: 'crdt-sync',
                docId: DOC_ID_ASSET,
                data: JSON.stringify({ type: 'asset.manifest', manifest } satisfies AssetControlMessage),
            },
        });

        // Send requested chunks (or all if none specified). `missingChunks` is
        // remote input: an unbounded, duplicate-laden or out-of-range list would
        // otherwise drive an arbitrarily long slice-encode-send loop on this
        // peer. Bound while filtering, never before: deduplicating first would
        // materialize a `Set` at the sender's declared cardinality, which the
        // CRDT framing lets reach tens of millions of elements.
        const chunksToSend = isNonEmptyIndexList(missingChunks)
            ? boundedChunkIndices(missingChunks, chunkCount)
            : Array.from({ length: chunkCount }, (_, index1) => index1);

        for (const index of chunksToSend) {
            const start = index * ASSET_CHUNK_SIZE;
            const end = Math.min(start + ASSET_CHUNK_SIZE, blob.size);
            const slice = blob.slice(start, end);
            const buffer = await slice.arrayBuffer();
            const base64 = arrayBufferToBase64(buffer);

            await this.peerManager.sendCrdtSyncBuffered({
                peerId,
                message: {
                    type: 'crdt-sync',
                    docId: DOC_ID_ASSET,
                    data: JSON.stringify({
                        type: 'asset.chunk',
                        hash,
                        index,
                        data: base64,
                    } satisfies AssetControlMessage),
                },
            });
        }
    }

    private handleManifest(_peerId: PeerId, manifest: AssetManifest): void {
        // Already have the asset — nothing to fetch.
        if (this.localAssets.has(manifest.hash)) {
            return;
        }

        // Ignore manifests for hashes this peer never requested. An incoming
        // manifest must answer an outstanding requestAsset, otherwise a remote
        // peer could spin up an arbitrary number of transfer slots we never
        // asked for (unsolicited-manifest memory DoS).
        if (!this.requestedHashes.has(manifest.hash)) {
            return;
        }

        // First-responder-wins: once a transfer is in flight for this hash, the
        // chosen manifest is locked in and later manifests (from other peers)
        // are ignored. Without this, every peer's manifest would overwrite the
        // slot and reset progress, fanning out the transfer to O(N) responders.
        if (this.incomingTransfers.has(manifest.hash)) {
            return;
        }

        // Reject manifests whose declared dimensions are inconsistent or
        // unbounded — these define the limits all later chunks are checked
        // against, so an untrustworthy manifest is itself a DoS vector.
        if (!isManifestSane(manifest)) {
            logger.warn(`[AssetTransfer] Rejecting malformed manifest for ${manifest.hash}`);
            return;
        }

        // The outstanding marker stays until the transfer terminates (see
        // `requestedHashes`); duplicate and stale manifests are already excluded
        // by the in-flight check above.
        this.incomingTransfers.set(manifest.hash, {
            manifest,
            chunks: new Map(),
            receivedBitmap: new Set(),
        });

        // Progress: restart the no-progress clock against the first chunk.
        this.armStallTimer(manifest.hash);
    }

    private handleChunk(hash: string, index: number, base64Data: unknown): void {
        // Reject chunks for a hash with no in-flight (requested) transfer. This
        // covers chunks arriving before/without a manifest, chunks from peers
        // that lost the first-responder race, and chunks for assets we already
        // hold or never asked for.
        const transfer = this.incomingTransfers.get(hash);
        if (!transfer) {
            return;
        }

        const { manifest } = transfer;

        // Reject out-of-range indices. A malicious peer could otherwise store
        // chunks at arbitrary indices (including indices >= chunkCount),
        // growing transfer.chunks without bound.
        if (!Number.isInteger(index) || index < 0 || index >= manifest.chunkCount) {
            this.abortTransfer(hash, `chunk ${index} is outside the declared range`);
            return;
        }

        // Bound the payload before decoding it, not after. Decoding allocates
        // the full chunk, so a payload that is certain to be refused still costs
        // its own decoded size first — repeatable at line rate. The encoded
        // length is an exact function of the decoded length, so the declared
        // chunk size can be enforced on the string itself.
        if (typeof base64Data !== 'string') {
            this.abortTransfer(hash, `chunk ${index} payload is not a string`);
            return;
        }
        if (base64Data.length > base64LengthFor(manifest.chunkSize)) {
            this.abortTransfer(hash, `chunk ${index} encodes more than the declared chunk size ${manifest.chunkSize}`);
            return;
        }

        let data: Uint8Array;
        try {
            data = base64ToBytes(base64Data);
        } catch {
            this.abortTransfer(hash, `chunk ${index} is not valid base64`);
            return;
        }

        // The encoded bound admits one trailing padding group, so the decoded
        // length is still checked exactly against the manifest.
        if (data.byteLength > manifest.chunkSize) {
            this.abortTransfer(
                hash,
                `chunk ${index} is ${data.byteLength} bytes, over the declared chunk size ${manifest.chunkSize}`
            );
            return;
        }

        // Whether this chunk is new decides whether the stall clock restarts: a
        // duplicate is not progress, and re-arming on one lets a peer replaying
        // a single already-received index below the deadline pin the transfer —
        // and with it the hash's outstanding marker — for the whole session.
        const receivedBefore = transfer.receivedBitmap.size;
        transfer.chunks.set(index, data);
        transfer.receivedBitmap.add(index);
        const progressed = transfer.receivedBitmap.size > receivedBefore;

        this.callbacks.onProgress(hash, transfer.receivedBitmap.size, manifest.chunkCount);

        if (transfer.receivedBitmap.size === manifest.chunkCount) {
            // Completion is single-shot: the slot is released before the async
            // assembly is dispatched, so a duplicate completing chunk arriving
            // during the digest finds no transfer instead of launching a second
            // full-size reassembly. The captured `transfer` carries the chunks.
            this.clearStallTimer(hash);
            this.incomingTransfers.delete(hash);
            void this.assembleAsset(hash, transfer);
            return;
        }

        if (progressed) {
            // Progress: restart the no-progress clock against the next chunk.
            this.armStallTimer(hash);
        }
    }

    /**
     * Turn a fully-received transfer into a verified local asset.
     *
     * The caller has already released the transfer slot and cleared the stall
     * timer, so nothing else will ever end this hash: every exit here must be
     * terminal *and* reported. A silent return would leave the hash outstanding
     * with no timer armed — unrecoverable even by the stall path — which is why
     * the missing-chunk case and every rejection (a digest or `arrayBuffer` over
     * a half-gigabyte blob can fail on memory alone) route through
     * `abortTransfer` rather than escaping under the caller's `void`.
     */
    private async assembleAsset(
        hash: string,
        transfer: {
            manifest: AssetManifest;
            chunks: Map<number, Uint8Array>;
        }
    ): Promise<void> {
        try {
            const sortedChunks: Uint8Array[] = [];
            for (let index = 0; index < transfer.manifest.chunkCount; index++) {
                const chunk = transfer.chunks.get(index);
                if (!chunk) {
                    this.abortTransfer(hash, `chunk ${index} was missing at assembly`);
                    return;
                }
                sortedChunks.push(chunk);
            }

            const totalSize = sortedChunks.reduce((sum, context) => sum + context.length, 0);
            const assembled = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of sortedChunks) {
                assembled.set(chunk, offset);
                offset += chunk.length;
            }

            const blob = new Blob([assembled], { type: transfer.manifest.mime });

            // Verify integrity before accepting the asset.
            const actualHash = await hashBlob(blob);
            if (actualHash !== hash) {
                this.abortTransfer(hash, `integrity check failed (received ${actualHash})`);
                return;
            }

            // The immutable Blob was hashed immediately above; carry that
            // verification into the durable write instead of digesting the
            // same full-size original a second time.
            const stored = await this.durableAssets.storeDurableAsset(blob, transfer.manifest.name, actualHash);
            if (stored.hash !== hash) {
                this.abortTransfer(hash, `integrity check failed while storing ${stored.hash}`);
                return;
            }
            this.localAssets.set(hash, { blob: stored.blob, name: stored.name });
            this.clearStallTimer(hash);
            this.requestedHashes.delete(hash);
            // The asset resolved, so the hash owes nothing to the retry policy.
            this.retryNotBefore.delete(hash);
            this.failedAttempts.delete(hash);
            this.callbacks.onAssetAvailable(hash);
        } catch (error) {
            this.abortTransfer(hash, `assembly failed (${describeError(error)})`);
        }
    }
}

/** Message text for a caught unknown, without laundering it through a cast. */
function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Encoded length of `byteLength` bytes of base64: four characters per
 * three-byte group, the last group padded. Exact, so it bounds a chunk payload
 * before decoding without refusing any legally-sized one.
 */
function base64LengthFor(byteLength: number): number {
    return 4 * Math.ceil(byteLength / 3);
}

/**
 * Collect the chunk indices a requester actually asked for, bounded as they are
 * read.
 *
 * The input is remote and its length is only bounded by the CRDT channel's
 * reassembly ceiling — tens of millions of elements. Retention is therefore
 * capped at `chunkCount` entries regardless of input length, and the pass stops
 * as soon as the whole asset is covered.
 */
function boundedChunkIndices(requested: readonly unknown[], chunkCount: number): number[] {
    const selected = new Set<number>();
    for (const value of requested) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= chunkCount) {
            continue;
        }
        selected.add(value);
        if (selected.size === chunkCount) {
            break;
        }
    }
    return [...selected];
}

/**
 * Whether a remote-supplied `missingChunks` field is a list worth reading. Its
 * elements stay `unknown`: they are validated one at a time in
 * {@link boundedChunkIndices}, never trusted in bulk.
 */
function isNonEmptyIndexList(value: unknown): value is readonly unknown[] {
    return Array.isArray(value) && value.length > 0;
}

/**
 * Validate a manifest's declared dimensions before committing to a transfer.
 *
 * The manifest is attacker-controlled: every later chunk is bounds-checked
 * against `chunkCount` and `chunkSize`, so an inconsistent or unbounded
 * manifest is itself a memory-DoS vector. Reject anything non-integral,
 * negative, mutually inconsistent, outside the accepted chunk-size range, or
 * over the hard size ceiling — plus any metadata string a sender could inflate,
 * since the name is retained with the assembled asset.
 */
function isManifestSane(manifest: AssetManifest): boolean {
    const { size, chunkSize, chunkCount, name, mime } = manifest;

    if (typeof name !== 'string' || name.length > MAX_ASSET_NAME_LEN) {
        return false;
    }
    if (typeof mime !== 'string' || mime.length > MAX_ASSET_MIME_LEN) {
        return false;
    }
    // Size 0 is refused rather than accepted: a zero-byte asset yields
    // `chunkCount: 0`, and completion is only ever evaluated when a chunk lands,
    // so such a transfer could not finish — it would occupy a slot until the
    // stall deadline and then abort. No sender this app runs mints one.
    if (!Number.isInteger(size) || size <= 0 || size > MAX_ASSET_SIZE) {
        return false;
    }
    // Bounded from both ends: the ceiling stops one chunk from claiming the
    // whole byte budget, and the floor stops a `chunkSize: 1` manifest from
    // declaring one Map+Set slot per byte of an otherwise legal size.
    if (!Number.isInteger(chunkSize) || chunkSize < MIN_ASSET_CHUNK_SIZE || chunkSize > MAX_ASSET_CHUNK_SIZE) {
        return false;
    }
    if (!Number.isInteger(chunkCount) || chunkCount < 1) {
        return false;
    }
    // chunkCount must be exactly the number of chunkSize-sized pieces that
    // cover `size`, so a manifest can't declare more chunks than its size needs.
    if (chunkCount !== Math.ceil(size / chunkSize)) {
        return false;
    }
    return true;
}

/** Hash a blob using SHA-256 (browser-native). BLAKE3 can be added via wasm. */
async function hashBlob(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return `sha256:${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    return bytesToBase64(new Uint8Array(buffer));
}
