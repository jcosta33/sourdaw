import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import {
    ASSET_CHUNK_SIZE,
    MAX_ASSET_CHUNK_SIZE,
    MAX_ASSET_MIME_LEN,
    MAX_ASSET_NAME_LEN,
    MAX_ASSET_SIZE,
    MIN_ASSET_CHUNK_SIZE,
    type PeerMessage,
} from '../../models/CollaborationTypes';
import { DOC_ID_ASSET } from '../../models/SyncChannelConstants';
import { type PeerConnectionManager } from '../../repositories/peerConnection';
import { AssetTransfer, ASSET_TRANSFER_STALL_TIMEOUT_MS } from '../assetTransfer';

function makePeerManager(): PeerConnectionManager {
    return {
        broadcastCrdtSync: vi.fn(),
        sendCrdtSync: vi.fn(),
        sendCrdtSyncBuffered: vi.fn(),
    } as unknown as PeerConnectionManager;
}

/**
 * Drive the host (asset-holder) side of a request so we capture the exact
 * wire messages — manifest + chunk(s) — it emits. Returns them in the order
 * a receiver would observe them, so a receiving AssetTransfer can replay them
 * through its public `handleMessage` surface.
 */
async function captureTransferMessages(blob: Blob, name: string): Promise<{ hash: string; messages: PeerMessage[] }> {
    const sent: PeerMessage[] = [];
    const hostPeer = {
        broadcastCrdtSync: vi.fn(),
        // The host replies to the requester via sendCrdtSync (manifest) and
        // sendCrdtSyncBuffered (chunks). Capture both into one ordered list.
        sendCrdtSync: vi.fn(({ message }: { peerId: string; message: PeerMessage }) => {
            sent.push(message);
        }),
        sendCrdtSyncBuffered: vi.fn(({ message }: { peerId: string; message: PeerMessage }) => {
            sent.push(message);
            return Promise.resolve();
        }),
    } as unknown as PeerConnectionManager;

    const host = new AssetTransfer(hostPeer, {
        onAssetAvailable: vi.fn(),
        onProgress: vi.fn(),
        onTransferFailed: vi.fn(),
    });
    const hash = await host.addLocalAsset(blob, name);

    // Simulate the requester's `asset.request` arriving at the host.
    await host.handleMessage('requester', {
        type: 'crdt-sync',
        docId: DOC_ID_ASSET,
        data: JSON.stringify({ type: 'asset.request', hash, missingChunks: [] }),
    });

    return { hash, messages: sent };
}

describe('AssetTransfer', () => {
    let peer: PeerConnectionManager;
    let onAssetAvailable: Mock<(hash: string) => void>;
    let onProgress: Mock<(hash: string, receivedChunks: number, totalChunks: number) => void>;
    let onTransferFailed: Mock<(hash: string, reason: string) => void>;
    let transfer: AssetTransfer;

    beforeEach(() => {
        peer = makePeerManager();
        onAssetAvailable = vi.fn<(hash: string) => void>();
        onProgress = vi.fn<(hash: string, receivedChunks: number, totalChunks: number) => void>();
        onTransferFailed = vi.fn<(hash: string, reason: string) => void>();
        transfer = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed });
    });

    afterEach(() => {
        // Every test leaves at most one instance; disposing clears any armed
        // stall timer so a later test's fake clock can't inherit it.
        transfer.dispose();
        vi.useRealTimers();
    });

    it('addLocalAsset hashes and stores a blob', async () => {
        const blob = new Blob(['hello'], { type: 'text/plain' });
        const hash = await transfer.addLocalAsset(blob, 'hello.txt');

        expect(hash.startsWith('sha256:')).toBe(true);
        expect(transfer.hasAsset(hash)).toBe(true);
        expect(transfer.getAsset(hash)).toBe(blob);
    });

    it('stages duplicate content without claiming ownership of the existing asset', async () => {
        const existing = new Blob(['same-content'], { type: 'text/plain' });
        const duplicate = new Blob(['same-content'], { type: 'text/plain' });
        const existingHash = await transfer.addLocalAsset(existing, 'existing.txt');

        const staged = await transfer.stageLocalAsset(duplicate, 'duplicate.txt');

        expect(staged).toEqual({ hash: existingHash, leaseId: expect.stringMatching(/^asset-stage-/u) });
        expect(transfer.getAsset(existingHash)).toBe(existing);
    });

    it('does not delete a committed duplicate when an earlier staging owner is cancelled', async () => {
        const first = await transfer.stageLocalAsset(new Blob(['same-content']), 'first.wav');
        const second = await transfer.stageLocalAsset(new Blob(['same-content']), 'second.wav');
        expect(second.hash).toBe(first.hash);

        transfer.promoteStagedAsset(second.leaseId);
        transfer.releaseStagedAsset(first.leaseId);

        expect(transfer.hasAsset(second.hash)).toBe(true);
    });

    it('requestAsset broadcasts an asset.request message', () => {
        transfer.requestAsset('sha256:abc');
        expect(peer.broadcastCrdtSync).toHaveBeenCalledWith(
            expect.objectContaining({
                docId: DOC_ID_ASSET,
                data: expect.stringContaining('asset.request'),
            })
        );
    });

    it('handleMessage ignores messages with the wrong docId', async () => {
        await transfer.handleMessage('peer-1', {
            type: 'crdt-sync',
            docId: 'other',
            data: 'noise',
        } as never);
        expect(peer.sendCrdtSync).not.toHaveBeenCalled();
    });

    it('hasAsset returns false for unknown hashes', () => {
        expect(transfer.hasAsset('sha256:none')).toBe(false);
    });

    it('reassembles an asset from a manifest + chunk stream and signals availability', async () => {
        // A payload large enough to span more than one 256 KiB chunk, so the
        // receive path exercises multi-chunk progress and ordered assembly.
        const payload = new Uint8Array(300 * 1024);
        for (let index = 0; index < payload.length; index++) {
            payload[index] = index % 256;
        }
        const { hash, messages } = await captureTransferMessages(
            new Blob([payload], { type: 'audio/wav' }),
            'take.wav'
        );

        // The receiver must have an outstanding request for the hash before a
        // manifest is accepted — unsolicited manifests are dropped as a DoS
        // guard, so the real flow always issues requestAsset first.
        transfer.requestAsset(hash);

        // Sanity: the host emitted one manifest followed by >1 chunk.
        const manifestCount = messages.filter(
            (m) => m.type === 'crdt-sync' && m.data.includes('asset.manifest')
        ).length;
        const chunkCount = messages.filter((m) => m.type === 'crdt-sync' && m.data.includes('asset.chunk')).length;
        expect(manifestCount).toBe(1);
        expect(chunkCount).toBeGreaterThan(1);

        // The receiver should not hold the asset until the full stream arrives.
        for (const message of messages) {
            expect(transfer.hasAsset(hash)).toBe(false);
            await transfer.handleMessage('host', message);
        }

        // Final assembly (hash digest + store) runs as a fire-and-forget async
        // task kicked off inside the last handleChunk, so wait for it to settle
        // rather than asserting synchronously on the next tick.
        await vi.waitFor(() => expect(onAssetAvailable).toHaveBeenCalledWith(hash));
        expect(transfer.hasAsset(hash)).toBe(true);
        // Progress is reported once per received chunk, ending at total === total.
        expect(onProgress).toHaveBeenCalledTimes(chunkCount);
        const lastProgress = onProgress.mock.calls.at(-1);
        expect(lastProgress?.[1]).toBe(chunkCount);
        expect(lastProgress?.[2]).toBe(chunkCount);

        const stored = transfer.getAsset(hash);
        expect(stored).toBeInstanceOf(Blob);
        expect(stored?.size).toBe(payload.length);
        expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(payload);
    });

    it('ignores chunks for a transfer whose manifest was never received', async () => {
        const { messages } = await captureTransferMessages(new Blob(['orphan'], { type: 'text/plain' }), 'o.txt');
        const chunkMessage = messages.find((m) => m.type === 'crdt-sync' && m.data.includes('asset.chunk'));
        expect(chunkMessage).toBeDefined();

        await transfer.handleMessage('host', chunkMessage!);

        // No manifest registered → chunk is dropped, no progress, no availability.
        expect(onProgress).not.toHaveBeenCalled();
        expect(onAssetAvailable).not.toHaveBeenCalled();
    });

    it('does not re-register an asset it already holds when a manifest arrives', async () => {
        // Receiver already owns the asset locally.
        const blob = new Blob(['owned'], { type: 'text/plain' });
        const hash = await transfer.addLocalAsset(blob, 'owned.txt');

        const { messages } = await captureTransferMessages(blob, 'owned.txt');
        const manifest = messages.find((m) => m.type === 'crdt-sync' && m.data.includes('asset.manifest'));
        const chunk = messages.find((m) => m.type === 'crdt-sync' && m.data.includes('asset.chunk'));

        await transfer.handleMessage('host', manifest!);
        // Because the manifest was ignored (asset already held), the chunk has
        // no transfer to attach to and is dropped — onProgress stays silent.
        await transfer.handleMessage('host', chunk!);

        expect(onProgress).not.toHaveBeenCalled();
        // The already-held asset is untouched.
        expect(transfer.getAsset(hash)).toBe(blob);
    });

    it('rejects a fully-received asset whose bytes do not hash to the claimed hash', async () => {
        const { hash, messages } = await captureTransferMessages(
            new Blob(['tamper-me'], { type: 'text/plain' }),
            'corrupt.txt'
        );

        // Solicit the asset so the manifest is accepted; the corruption must be
        // caught by the integrity check, not silently dropped at the manifest.
        transfer.requestAsset(hash);

        // Corrupt exactly one chunk's bytes on the wire so the reassembled blob
        // no longer matches the manifest hash, tripping the integrity check.
        // Operate on the raw JSON wire string (not a parsed `any`) and flip the
        // first base64 char of the chunk payload — same decoded length, different
        // bytes — so the chunk decodes but reassembly yields a different hash.
        const corrupted: PeerMessage[] = messages.map((message) => {
            if (message.type !== 'crdt-sync' || !message.data.includes('asset.chunk')) {
                return message;
            }
            const flippedData = message.data.replace(/("data":")(.)/, (_match, prefix: string, first: string) =>
                first === 'A' ? `${prefix}B` : `${prefix}A`
            );
            return { ...message, data: flippedData };
        });

        for (const message of corrupted) {
            await transfer.handleMessage('host', message);
        }

        // Integrity check fails → asset rejected, transfer discarded, no callback.
        expect(transfer.hasAsset(hash)).toBe(false);
        expect(onAssetAvailable).not.toHaveBeenCalled();
    });

    // --- DoS guards: solicited-manifest, first-responder-wins, chunk validation ---

    const HASH = 'sha256:guarded';

    function manifestMessage(overrides: Record<string, unknown> = {}): PeerMessage {
        return {
            type: 'crdt-sync',
            docId: DOC_ID_ASSET,
            data: JSON.stringify({
                type: 'asset.manifest',
                manifest: {
                    hash: HASH,
                    size: 10,
                    chunkSize: 256 * 1024,
                    chunkCount: 1,
                    name: 'a.bin',
                    mime: 'application/octet-stream',
                    ...overrides,
                },
            }),
        };
    }

    function chunkMessage(index: number, data: string): PeerMessage {
        return {
            type: 'crdt-sync',
            docId: DOC_ID_ASSET,
            data: JSON.stringify({ type: 'asset.chunk', hash: HASH, index, data }),
        };
    }

    it('ignores an unsolicited manifest for a hash never requested', async () => {
        // No requestAsset call → the manifest must not open a transfer slot.
        await transfer.handleMessage('peer-1', manifestMessage());

        // A chunk for that hash is therefore dropped (no in-flight transfer).
        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('data')));
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('accepts a manifest only after the hash was requested', async () => {
        transfer.requestAsset(HASH);
        await transfer.handleMessage('peer-1', manifestMessage());

        // A valid chunk is now accepted and progress is reported.
        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('1234567890')));
        expect(onProgress).toHaveBeenCalledWith(HASH, 1, 1);
    });

    it('first-responder-wins: a late manifest does not reset an in-flight transfer', async () => {
        transfer.requestAsset(HASH);
        // First responder opens a consistent 2-chunk transfer and delivers chunk 0.
        const twoChunk = {
            size: MIN_ASSET_CHUNK_SIZE * 2,
            chunkSize: MIN_ASSET_CHUNK_SIZE,
            chunkCount: 2,
        };
        const fullChunk = btoa('a'.repeat(MIN_ASSET_CHUNK_SIZE));
        await transfer.handleMessage('peer-1', manifestMessage(twoChunk));
        await transfer.handleMessage('peer-1', chunkMessage(0, fullChunk));
        onProgress.mockClear();

        // A late manifest from a second peer must be ignored (no slot reset).
        await transfer.handleMessage('peer-2', manifestMessage(twoChunk));
        // Chunk 1 completes the ORIGINAL transfer — chunk 0 was retained, so
        // the final progress is 2/2 rather than restarting from 1/2.
        await transfer.handleMessage('peer-2', chunkMessage(1, fullChunk));
        expect(onProgress).toHaveBeenLastCalledWith(HASH, 2, 2);
    });

    it('rejects and aborts on a chunk whose index is out of range', async () => {
        transfer.requestAsset(HASH);
        await transfer.handleMessage('peer-1', manifestMessage());

        // index 1 is >= chunkCount (1) → rejected, transfer aborted.
        await transfer.handleMessage('peer-1', chunkMessage(1, btoa('x')));
        expect(onProgress).not.toHaveBeenCalled();

        // The transfer was dropped, so a subsequent in-range chunk is ignored too.
        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('x')));
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('rejects a chunk whose decoded size exceeds the declared chunk size', async () => {
        transfer.requestAsset(HASH);
        // Declare the smallest legal chunkSize so an oversized chunk trips the bound.
        await transfer.handleMessage(
            'peer-1',
            manifestMessage({ size: MIN_ASSET_CHUNK_SIZE, chunkSize: MIN_ASSET_CHUNK_SIZE, chunkCount: 1 })
        );

        const oversized = btoa('x'.repeat(MIN_ASSET_CHUNK_SIZE + 1));
        await transfer.handleMessage('peer-1', chunkMessage(0, oversized));
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('rejects a manifest with inconsistent dimensions', async () => {
        transfer.requestAsset(HASH);
        // chunkCount does not equal ceil(size / chunkSize).
        await transfer.handleMessage(
            'peer-1',
            manifestMessage({ size: 10, chunkSize: ASSET_CHUNK_SIZE, chunkCount: 99 })
        );

        // No transfer opened → a chunk for it is dropped.
        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('data')));
        expect(onProgress).not.toHaveBeenCalled();
    });

    // --- F7: manifest dimension bounds -------------------------------------

    it('rejects a manifest whose chunk size is below the accepted floor', async () => {
        transfer.requestAsset(HASH);
        // Internally consistent and inside the byte ceiling, but declares one
        // chunk slot per byte: ~5e8 Map + Set entries once chunks start landing.
        await transfer.handleMessage(
            'peer-1',
            manifestMessage({ size: MAX_ASSET_SIZE, chunkSize: 1, chunkCount: MAX_ASSET_SIZE })
        );

        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('x')));
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('rejects a manifest whose chunk size is above the accepted ceiling', async () => {
        transfer.requestAsset(HASH);
        const chunkSize = MAX_ASSET_CHUNK_SIZE + 1;
        await transfer.handleMessage('peer-1', manifestMessage({ size: chunkSize, chunkSize, chunkCount: 1 }));

        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('x')));
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('rejects a manifest with an over-long name or mime string', async () => {
        transfer.requestAsset(HASH);
        await transfer.handleMessage('peer-1', manifestMessage({ name: 'n'.repeat(MAX_ASSET_NAME_LEN + 1) }));
        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('x')));
        expect(onProgress).not.toHaveBeenCalled();

        await transfer.handleMessage('peer-1', manifestMessage({ mime: 'm'.repeat(MAX_ASSET_MIME_LEN + 1) }));
        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('x')));
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('accepts the chunk size this app actually sends', async () => {
        // Guards the two bounds against each other: a floor or ceiling that
        // excluded ASSET_CHUNK_SIZE would make every manifest this app mints
        // unacceptable to its own peers.
        expect(ASSET_CHUNK_SIZE).toBeGreaterThanOrEqual(MIN_ASSET_CHUNK_SIZE);
        expect(ASSET_CHUNK_SIZE).toBeLessThanOrEqual(MAX_ASSET_CHUNK_SIZE);

        transfer.requestAsset(HASH);
        await transfer.handleMessage('peer-1', manifestMessage());
        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('1234567890')));
        expect(onProgress).toHaveBeenCalledWith(HASH, 1, 1);
    });

    it('bounds a remote missingChunks list to the indices the asset actually has', async () => {
        const sent: PeerMessage[] = [];
        const hostPeer = {
            broadcastCrdtSync: vi.fn(),
            sendCrdtSync: vi.fn(),
            sendCrdtSyncBuffered: vi.fn(({ message }: { peerId: string; message: PeerMessage }) => {
                sent.push(message);
                return Promise.resolve();
            }),
        } as unknown as PeerConnectionManager;
        const host = new AssetTransfer(hostPeer, {
            onAssetAvailable: vi.fn(),
            onProgress: vi.fn(),
            onTransferFailed: vi.fn(),
        });
        const hash = await host.addLocalAsset(new Blob(['tiny'], { type: 'text/plain' }), 'tiny.txt');

        // A hostile request: duplicates and out-of-range indices. The asset is
        // one chunk, so at most one chunk send may result.
        await host.handleMessage('attacker', {
            type: 'crdt-sync',
            docId: DOC_ID_ASSET,
            data: JSON.stringify({
                type: 'asset.request',
                hash,
                missingChunks: [0, 0, 0, 5, 99, -1, 1.5, Number.MAX_SAFE_INTEGER],
            }),
        });

        expect(sent).toHaveLength(1);
        host.dispose();
    });

    // --- F6: abort recovery -------------------------------------------------

    it('reports a failure and re-opens the hash when a chunk is rejected', async () => {
        transfer.requestAsset(HASH);
        await transfer.handleMessage('peer-1', manifestMessage());
        vi.mocked(peer.broadcastCrdtSync).mockClear();

        // Out-of-range chunk aborts the transfer.
        await transfer.handleMessage('peer-1', chunkMessage(1, btoa('x')));

        expect(onTransferFailed).toHaveBeenCalledTimes(1);
        expect(onTransferFailed.mock.calls[0]?.[0]).toBe(HASH);

        // Recovery: the hash is requestable again, and a fresh manifest from a
        // different peer is accepted rather than dropped as unsolicited.
        transfer.requestAsset(HASH);
        expect(peer.broadcastCrdtSync).toHaveBeenCalledTimes(1);
        await transfer.handleMessage('peer-2', manifestMessage());
        await transfer.handleMessage('peer-2', chunkMessage(0, btoa('1234567890')));
        expect(onProgress).toHaveBeenCalledWith(HASH, 1, 1);
    });

    it('drops partial chunks and re-opens the hash when a transfer stalls', async () => {
        vi.useFakeTimers();
        const twoChunk = {
            size: MIN_ASSET_CHUNK_SIZE * 2,
            chunkSize: MIN_ASSET_CHUNK_SIZE,
            chunkCount: 2,
        };
        transfer.requestAsset(HASH);
        await transfer.handleMessage('peer-1', manifestMessage(twoChunk));
        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('a'.repeat(MIN_ASSET_CHUNK_SIZE))));
        expect(onProgress).toHaveBeenLastCalledWith(HASH, 1, 2);

        // The sender dies mid-stream: chunk 1 never arrives.
        vi.advanceTimersByTime(ASSET_TRANSFER_STALL_TIMEOUT_MS + 1);

        expect(onTransferFailed).toHaveBeenCalledTimes(1);
        expect(onTransferFailed.mock.calls[0]?.[0]).toBe(HASH);

        // The abandoned transfer released its slot: the late chunk 1 finds no
        // in-flight transfer, so the partial state is genuinely gone.
        vi.mocked(peer.broadcastCrdtSync).mockClear();
        onProgress.mockClear();
        await transfer.handleMessage('peer-1', chunkMessage(1, btoa('b'.repeat(MIN_ASSET_CHUNK_SIZE))));
        expect(onProgress).not.toHaveBeenCalled();

        // And the asset is fetchable again from scratch.
        transfer.requestAsset(HASH);
        expect(peer.broadcastCrdtSync).toHaveBeenCalledTimes(1);
    });

    it('does not stall a transfer that keeps making progress', async () => {
        vi.useFakeTimers();
        const twoChunk = {
            size: MIN_ASSET_CHUNK_SIZE * 2,
            chunkSize: MIN_ASSET_CHUNK_SIZE,
            chunkCount: 2,
        };
        transfer.requestAsset(HASH);

        // Each step sits just inside the deadline; the clock must restart on
        // every accepted message rather than measure total duration.
        vi.advanceTimersByTime(ASSET_TRANSFER_STALL_TIMEOUT_MS - 1);
        await transfer.handleMessage('peer-1', manifestMessage(twoChunk));
        vi.advanceTimersByTime(ASSET_TRANSFER_STALL_TIMEOUT_MS - 1);
        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('a'.repeat(MIN_ASSET_CHUNK_SIZE))));
        vi.advanceTimersByTime(ASSET_TRANSFER_STALL_TIMEOUT_MS - 1);

        expect(onTransferFailed).not.toHaveBeenCalled();
        expect(onProgress).toHaveBeenLastCalledWith(HASH, 1, 2);
    });

    it('requestAsset is idempotent while a request is outstanding', () => {
        transfer.requestAsset(HASH);
        transfer.requestAsset(HASH);
        transfer.requestAsset(HASH);

        expect(peer.broadcastCrdtSync).toHaveBeenCalledTimes(1);
    });

    it('dispose clears armed stall timers so a discarded session reports nothing', async () => {
        vi.useFakeTimers();
        transfer.requestAsset(HASH);
        await transfer.handleMessage('peer-1', manifestMessage());

        transfer.dispose();
        vi.advanceTimersByTime(ASSET_TRANSFER_STALL_TIMEOUT_MS * 2);

        expect(onTransferFailed).not.toHaveBeenCalled();
    });
});
