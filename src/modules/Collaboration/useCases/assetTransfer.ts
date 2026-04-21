import { logger } from '#/infra/logger/appLogger';
import { base64ToBytes, bytesToBase64 } from '#/utils/base64';

import { type PeerId, type PeerMessage } from '../models/CollaborationTypes';
import { DOC_ID_ASSET } from '../models/syncChannelConstants';
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

        this.peerManager.sendCrdtSync({
            peerId,
            message: {
                type: 'crdt-sync',
                docId: DOC_ID_ASSET,
                data: JSON.stringify({ type: 'asset.manifest', manifest } satisfies AssetControlMessage),
            },
        });

        // Send requested chunks (or all if none specified)
        const chunksToSend = missingChunks.length > 0 ? missingChunks : Array.from({ length: chunkCount }, (_, index1) => index1);

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
        if (this.localAssets.has(manifest.hash)) {
            return;
        }

        this.incomingTransfers.set(manifest.hash, {
            manifest,
            chunks: new Map(),
            receivedBitmap: new Set(),
        });
    }

    private handleChunk(hash: string, index: number, base64Data: string): void {
        const transfer = this.incomingTransfers.get(hash);
        if (!transfer) {
            return;
        }

        const data = base64ToArrayBuffer(base64Data);
        transfer.chunks.set(index, new Uint8Array(data));
        transfer.receivedBitmap.add(index);

        this.callbacks.onProgress(hash, transfer.receivedBitmap.size, transfer.manifest.chunkCount);

        // Check if all chunks received
        if (transfer.receivedBitmap.size === transfer.manifest.chunkCount) {
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
