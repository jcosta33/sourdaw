import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssetTransfer } from './assetTransfer';
import { type PeerConnectionManager } from '../repositories/peerConnection';

function makePeerManager(): PeerConnectionManager {
    return {
        broadcastCrdtSync: vi.fn(),
        sendCrdtSync: vi.fn(),
        sendCrdtSyncBuffered: vi.fn(),
    } as unknown as PeerConnectionManager;
}

describe('AssetTransfer', () => {
    let peer: PeerConnectionManager;
    let onAssetAvailable: ReturnType<typeof vi.fn>;
    let onProgress: ReturnType<typeof vi.fn>;
    let transfer: AssetTransfer;

    beforeEach(() => {
        peer = makePeerManager();
        onAssetAvailable = vi.fn();
        onProgress = vi.fn();
        transfer = new AssetTransfer(peer, { onAssetAvailable, onProgress });
    });

    it('addLocalAsset hashes and stores a blob', async () => {
        const blob = new Blob(['hello'], { type: 'text/plain' });
        const hash = await transfer.addLocalAsset(blob, 'hello.txt');

        expect(hash.startsWith('sha256:')).toBe(true);
        expect(transfer.hasAsset(hash)).toBe(true);
        expect(transfer.getAsset(hash)).toBe(blob);
    });

    it('requestAsset broadcasts an asset.request message', () => {
        transfer.requestAsset('sha256:abc');
        expect(peer.broadcastCrdtSync).toHaveBeenCalledWith(
            expect.objectContaining({
                docId: '__asset__',
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
});
