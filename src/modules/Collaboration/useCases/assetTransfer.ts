import { logger } from '#/infra/logger/appLogger';
import { base64ToBytes, bytesToBase64 } from '#/utils/base64';

import {
    ASSET_CHUNK_SIZE,
    MAX_ASSET_CHUNK_SIZE,
    MAX_ASSET_MIME_LEN,
    MAX_ASSET_NAME_LEN,
    MAX_ASSET_SIZE,
    MIN_ASSET_CHUNK_SIZE,
    type PeerId,
    type PeerMessage,
} from '../models/CollaborationTypes';
import { DOC_ID_ASSET } from '../models/SyncChannelConstants';
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
    durable: boolean;
    stagingLeaseIds: Set<string>;
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

    /** Local content store with durable and pending-staging ownership. */
    private localAssets = new Map<string, LocalAssetEntry>();
    private stagingLeaseHashById = new Map<string, string>();

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
     * Per-hash stall deadline. Armed when a hash is requested and re-armed on
     * every accepted manifest or chunk, so the timer measures time since the
     * last observable progress rather than total transfer duration.
     */
    private stallTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(peerManager: PeerConnectionManager, callbacks: AssetTransferCallbacks) {
        this.peerManager = peerManager;
        this.callbacks = callbacks;
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
    }

    /** Register a local asset (e.g. after recording or importing). */
    async addLocalAsset(blob: Blob, name: string): Promise<string> {
        const hash = await hashBlob(blob);
        const existing = this.localAssets.get(hash);
        if (existing) {
            existing.durable = true;
        } else {
            this.localAssets.set(hash, { blob, name, durable: true, stagingLeaseIds: new Set() });
        }
        return hash;
    }

    /** Stage an import asset under a unique lease until project commit or cancellation. */
    async stageLocalAsset(blob: Blob, name: string): Promise<{ hash: string; leaseId: string }> {
        const hash = await hashBlob(blob);
        const leaseId = `asset-stage-${crypto.randomUUID()}`;
        const existing = this.localAssets.get(hash);
        if (existing) {
            existing.stagingLeaseIds.add(leaseId);
        } else {
            this.localAssets.set(hash, { blob, name, durable: false, stagingLeaseIds: new Set([leaseId]) });
        }
        this.stagingLeaseHashById.set(leaseId, hash);
        return { hash, leaseId };
    }

    /** Release one unresolved staging reference, deleting only uncommitted unshared data. */
    releaseStagedAsset(leaseId: string): void {
        const hash = this.stagingLeaseHashById.get(leaseId);
        if (!hash) {
            return;
        }
        this.stagingLeaseHashById.delete(leaseId);
        const entry = this.localAssets.get(hash);
        if (!entry) {
            return;
        }
        entry.stagingLeaseIds.delete(leaseId);
        if (!entry.durable && entry.stagingLeaseIds.size === 0) {
            this.localAssets.delete(hash);
        }
    }

    /** Promote one staging reference to durable project-owned availability. */
    promoteStagedAsset(leaseId: string): void {
        const hash = this.stagingLeaseHashById.get(leaseId);
        if (!hash) {
            return;
        }
        this.stagingLeaseHashById.delete(leaseId);
        const entry = this.localAssets.get(hash);
        if (!entry) {
            throw new Error(`Cannot promote missing staged asset lease: ${leaseId}`);
        }
        entry.stagingLeaseIds.delete(leaseId);
        entry.durable = true;
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
     * recoverable inside the same session.
     */
    requestAsset(hash: string): void {
        if (this.localAssets.has(hash) || this.incomingTransfers.has(hash) || this.requestedHashes.has(hash)) {
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
     */
    private abortTransfer(hash: string, reason: string): void {
        this.clearStallTimer(hash);
        const wasOutstanding = this.requestedHashes.delete(hash);
        const wasInFlight = this.incomingTransfers.delete(hash);
        if (!wasOutstanding && !wasInFlight) {
            return;
        }
        logger.warn(`[AssetTransfer] Transfer for ${hash} aborted: ${reason}`);
        this.callbacks.onTransferFailed(hash, reason);
    }

    private async handleAssetRequest(peerId: PeerId, hash: string, missingChunks: unknown): Promise<void> {
        const entry = this.localAssets.get(hash);
        if (!entry) {
            return;
        }

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
        // peer. Deduplicate and keep only indices this asset actually has, which
        // caps the work at one pass over the asset.
        const chunksToSend = isNonEmptyIndexList(missingChunks)
            ? [...new Set(missingChunks)].filter((index) => Number.isInteger(index) && index >= 0 && index < chunkCount)
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

    private handleChunk(hash: string, index: number, base64Data: string): void {
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

        const data = base64ToArrayBuffer(base64Data);

        // Bound the decoded chunk size against the manifest's declared chunk
        // size. The manifest fixes chunkSize as the per-chunk maximum; any chunk
        // larger than that is oversized data the sender should never produce.
        if (data.byteLength > manifest.chunkSize) {
            this.abortTransfer(
                hash,
                `chunk ${index} is ${data.byteLength} bytes, over the declared chunk size ${manifest.chunkSize}`
            );
            return;
        }

        transfer.chunks.set(index, new Uint8Array(data));
        transfer.receivedBitmap.add(index);

        this.callbacks.onProgress(hash, transfer.receivedBitmap.size, manifest.chunkCount);

        // Check if all chunks received
        if (transfer.receivedBitmap.size === manifest.chunkCount) {
            this.clearStallTimer(hash);
            void this.assembleAsset(hash, transfer);
        } else {
            // Progress: restart the no-progress clock against the next chunk.
            this.armStallTimer(hash);
        }
    }

    private async assembleAsset(
        hash: string,
        transfer: {
            manifest: AssetManifest;
            chunks: Map<number, Uint8Array>;
        }
    ): Promise<void> {
        const sortedChunks: Uint8Array[] = [];
        for (let index = 0; index < transfer.manifest.chunkCount; index++) {
            const chunk = transfer.chunks.get(index);
            if (!chunk) {
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

        this.localAssets.set(hash, {
            blob,
            name: transfer.manifest.name,
            durable: true,
            stagingLeaseIds: new Set(),
        });
        this.clearStallTimer(hash);
        this.requestedHashes.delete(hash);
        this.incomingTransfers.delete(hash);
        this.callbacks.onAssetAvailable(hash);
    }
}

/** Whether a remote-supplied `missingChunks` field is a usable index list. */
function isNonEmptyIndexList(value: unknown): value is number[] {
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
    if (!Number.isInteger(size) || size < 0 || size > MAX_ASSET_SIZE) {
        return false;
    }
    // Bounded from both ends: the ceiling stops one chunk from claiming the
    // whole byte budget, and the floor stops a `chunkSize: 1` manifest from
    // declaring one Map+Set slot per byte of an otherwise legal size.
    if (!Number.isInteger(chunkSize) || chunkSize < MIN_ASSET_CHUNK_SIZE || chunkSize > MAX_ASSET_CHUNK_SIZE) {
        return false;
    }
    if (!Number.isInteger(chunkCount) || chunkCount < 0) {
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

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const bytes = base64ToBytes(base64);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
