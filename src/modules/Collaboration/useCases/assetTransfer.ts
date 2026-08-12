import { logger } from '#/infra/logger/appLogger';
import { base64ToBytes, bytesToBase64 } from '#/utils/base64';

import { type PeerId, type PeerMessage } from '../models/CollaborationTypes';
import { DOC_ID_ASSET } from '../models/SyncChannelConstants';
import { type PeerConnectionManager } from '../repositories/peerConnection';

const CHUNK_SIZE = 256 * 1024; // 256 KiB

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

    /** Local content store: hash → { blob, name } */
    private localAssets = new Map<string, { blob: Blob; name: string }>();

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
     * Hashes this peer has actively requested and is still awaiting a manifest
     * for. A manifest is only accepted if its hash is in this set, so a remote
     * peer cannot start (and grow) a transfer slot we never asked for
     * (unsolicited-manifest DoS). Cleared once a manifest is chosen — the
     * first responder wins and later manifests for the same hash are ignored.
     */
    private requestedHashes = new Set<string>();

    constructor(peerManager: PeerConnectionManager, callbacks: AssetTransferCallbacks) {
        this.peerManager = peerManager;
        this.callbacks = callbacks;
    }

    /** Register a local asset (e.g. after recording or importing). */
    async addLocalAsset(blob: Blob, name: string): Promise<string> {
        const hash = await hashBlob(blob);
        this.localAssets.set(hash, { blob, name });
        return hash;
    }

    /** Stage an import asset without taking ownership of an identical existing asset. */
    async stageLocalAsset(blob: Blob, name: string): Promise<{ hash: string; owned: boolean }> {
        const hash = await hashBlob(blob);
        const owned = !this.localAssets.has(hash);
        if (owned) {
            this.localAssets.set(hash, { blob, name });
        }
        return { hash, owned };
    }

    /** Remove an application-staged asset that never became project truth. */
    removeLocalAsset(hash: string): void {
        this.localAssets.delete(hash);
    }

    /** Check if an asset is available locally. */
    hasAsset(hash: string): boolean {
        return this.localAssets.has(hash);
    }

    /** Get a local asset by hash. */
    getAsset(hash: string): Blob | undefined {
        return this.localAssets.get(hash)?.blob;
    }

    /** Request a missing asset from connected peers. */
    requestAsset(hash: string): void {
        // A transfer already in flight already has (or is fetching) the asset.
        if (this.localAssets.has(hash) || this.incomingTransfers.has(hash)) {
            return;
        }

        // Mark the hash as outstanding so an incoming manifest for it is treated
        // as a solicited reply rather than an unsolicited transfer slot.
        this.requestedHashes.add(hash);

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

    private async handleAssetRequest(peerId: PeerId, hash: string, missingChunks: number[]): Promise<void> {
        const entry = this.localAssets.get(hash);
        if (!entry) {
            return;
        }

        const { blob, name } = entry;
        const chunkCount = Math.ceil(blob.size / CHUNK_SIZE);
        const manifest: AssetManifest = {
            hash,
            size: blob.size,
            chunkSize: CHUNK_SIZE,
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

        // Send requested chunks (or all if none specified)
        const chunksToSend =
            missingChunks.length > 0 ? missingChunks : Array.from({ length: chunkCount }, (_, index1) => index1);

        for (const index of chunksToSend) {
            const start = index * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, blob.size);
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

        // The request is now answered: drop the outstanding flag so duplicate
        // or stale manifests for the same hash are ignored from here on.
        this.requestedHashes.delete(manifest.hash);

        this.incomingTransfers.set(manifest.hash, {
            manifest,
            chunks: new Map(),
            receivedBitmap: new Set(),
        });
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
            logger.warn(`[AssetTransfer] Rejecting chunk ${index} for ${hash}: index out of range`);
            this.incomingTransfers.delete(hash);
            return;
        }

        const data = base64ToArrayBuffer(base64Data);

        // Bound the decoded chunk size against the manifest's declared chunk
        // size. The manifest fixes chunkSize as the per-chunk maximum; any chunk
        // larger than that is oversized data the sender should never produce.
        if (data.byteLength > manifest.chunkSize) {
            logger.warn(
                `[AssetTransfer] Rejecting chunk ${index} for ${hash}: ${data.byteLength} bytes exceeds declared chunk size ${manifest.chunkSize}`
            );
            this.incomingTransfers.delete(hash);
            return;
        }

        transfer.chunks.set(index, new Uint8Array(data));
        transfer.receivedBitmap.add(index);

        this.callbacks.onProgress(hash, transfer.receivedBitmap.size, manifest.chunkCount);

        // Check if all chunks received
        if (transfer.receivedBitmap.size === manifest.chunkCount) {
            void this.assembleAsset(hash, transfer);
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
            this.incomingTransfers.delete(hash);
            logger.warn(`[AssetTransfer] Integrity check failed for ${hash}: received ${actualHash}`);
            return;
        }

        this.localAssets.set(hash, { blob, name: transfer.manifest.name });
        this.incomingTransfers.delete(hash);
        this.callbacks.onAssetAvailable(hash);
    }
}

/** Hard ceiling on a single accepted asset transfer (512 MiB). */
const MAX_ASSET_SIZE = 512 * 1024 * 1024;

/**
 * Validate a manifest's declared dimensions before committing to a transfer.
 *
 * The manifest is attacker-controlled: every later chunk is bounds-checked
 * against `chunkCount` and `chunkSize`, so an inconsistent or unbounded
 * manifest is itself a memory-DoS vector. Reject anything non-integral,
 * negative, mutually inconsistent, or over the hard size ceiling.
 */
function isManifestSane(manifest: AssetManifest): boolean {
    const { size, chunkSize, chunkCount } = manifest;

    if (!Number.isInteger(size) || size < 0 || size > MAX_ASSET_SIZE) {
        return false;
    }
    if (!Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize > MAX_ASSET_SIZE) {
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
