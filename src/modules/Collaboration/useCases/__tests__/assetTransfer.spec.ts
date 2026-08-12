import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { type PeerMessage } from '../../models/CollaborationTypes';
import { DOC_ID_ASSET } from '../../models/SyncChannelConstants';
import { type PeerConnectionManager } from '../../repositories/peerConnection';
import { AssetTransfer } from '../assetTransfer';

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

    const host = new AssetTransfer(hostPeer, { onAssetAvailable: vi.fn(), onProgress: vi.fn() });
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
    let transfer: AssetTransfer;

    beforeEach(() => {
        peer = makePeerManager();
        onAssetAvailable = vi.fn<(hash: string) => void>();
        onProgress = vi.fn<(hash: string, receivedChunks: number, totalChunks: number) => void>();
        transfer = new AssetTransfer(peer, { onAssetAvailable, onProgress });
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

        expect(staged).toEqual({ hash: existingHash, owned: false });
        expect(transfer.getAsset(existingHash)).toBe(existing);
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
        const twoChunk = { size: 8, chunkSize: 4, chunkCount: 2 };
        await transfer.handleMessage('peer-1', manifestMessage(twoChunk));
        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('aaaa')));
        onProgress.mockClear();

        // A late manifest from a second peer must be ignored (no slot reset).
        await transfer.handleMessage('peer-2', manifestMessage(twoChunk));
        // Chunk 1 completes the ORIGINAL transfer — chunk 0 was retained, so
        // the final progress is 2/2 rather than restarting from 1/2.
        await transfer.handleMessage('peer-2', chunkMessage(1, btoa('bbbb')));
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
        // Declare a tiny chunkSize so an oversized chunk trips the bound.
        await transfer.handleMessage('peer-1', manifestMessage({ size: 4, chunkSize: 4, chunkCount: 1 }));

        const oversized = btoa('x'.repeat(64)); // 64 decoded bytes > declared 4
        await transfer.handleMessage('peer-1', chunkMessage(0, oversized));
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('rejects a manifest with inconsistent dimensions', async () => {
        transfer.requestAsset(HASH);
        // chunkCount does not equal ceil(size / chunkSize).
        await transfer.handleMessage('peer-1', manifestMessage({ size: 10, chunkSize: 4, chunkCount: 99 }));

        // No transfer opened → a chunk for it is dropped.
        await transfer.handleMessage('peer-1', chunkMessage(0, btoa('data')));
        expect(onProgress).not.toHaveBeenCalled();
    });
});
