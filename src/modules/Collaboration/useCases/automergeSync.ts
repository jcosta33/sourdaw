import * as Automerge from '@automerge/automerge';

import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument/models/CrdtDocumentTypes';
import { automergeRepository } from '#/modules/CrdtDocument/repositories/automergeRepository';
import { persistCrdtProject } from '#/modules/CrdtDocument/useCases/crdtProjectLifecycle';

import { type PeerId, type PeerMessage } from '../models/CollaborationTypes';
import { type PeerConnectionManager } from '../repositories/peerConnection';

type SyncStateMap = Map<PeerId, Automerge.SyncState>;

/**
 * Manages the Automerge sync protocol for all connected peers.
 *
 * Each peer has its own SyncState that tracks what they've seen.
 * When the local document changes, we generate sync messages for each peer.
 * When we receive a sync message, we apply it and hydrate stores.
 */
export class AutomergeSync {
    private syncStates: SyncStateMap = new Map();
    private peerManager: PeerConnectionManager;
    private unsubscribeFromChanges: (() => void) | null = null;

    constructor(peerManager: PeerConnectionManager) {
        this.peerManager = peerManager;
    }

    /** Start syncing: subscribe to local document changes. */
    start(): void {
        this.unsubscribeFromChanges = automergeRepository.onChange(() => {
            this.sendSyncToAllPeers();
        });
    }

    /** Stop syncing and clean up. */
    stop(): void {
        if (this.unsubscribeFromChanges) {
            this.unsubscribeFromChanges();
            this.unsubscribeFromChanges = null;
        }
        this.syncStates.clear();
    }

    /** Initialize sync state for a new peer and send initial sync. */
    addPeer(peerId: PeerId): void {
        this.syncStates.set(peerId, Automerge.initSyncState());
        this.sendSyncToPeer(peerId);
    }

    /** Remove sync state for a disconnected peer. */
    removePeer(peerId: PeerId): void {
        this.syncStates.delete(peerId);
    }

    /** Handle an incoming CRDT sync message from a peer. */
    receiveSync(peerId: PeerId, docId: string, syncMessageBase64: string): void {
        const doc = automergeRepository.getDoc(docId);
        if (!doc) {
            return;
        }

        const syncState = this.syncStates.get(peerId) ?? Automerge.initSyncState();

        let newDoc: Automerge.Doc<unknown>;
        let newSyncState: Automerge.SyncState;
        try {
            const syncMessage = base64ToBytes(syncMessageBase64);
            [newDoc, newSyncState] = Automerge.receiveSyncMessage(
                doc,
                syncState,
                syncMessage as Automerge.SyncMessage,
            );
        } catch (error) {
            console.error('[AutomergeSync] Malformed sync message from peer', peerId, error);
            return;
        }

        this.syncStates.set(peerId, newSyncState);

        // Update the document in the repository.
        // This triggers onChange → hydration + response sync messages.
        automergeRepository.replaceDoc(docId, newDoc);

        // Persist asynchronously — don't block the sync loop.
        persistCrdtProject().catch((error) => {
            console.error('[AutomergeSync] Failed to persist after receiving sync:', error);
        });
    }

    /** Handle an incoming peer message. */
    handlePeerMessage(peerId: PeerId, message: PeerMessage): void {
        if (message.type === 'crdt-sync') {
            this.receiveSync(peerId, message.docId, message.data);
        }
    }

    /** Generate and send sync messages to a specific peer. */
    private sendSyncToPeer(peerId: PeerId): void {
        const doc = automergeRepository.getDoc(DOC_PREFIX_ROOT);
        if (!doc) {
            return;
        }

        const syncState = this.syncStates.get(peerId) ?? Automerge.initSyncState();
        const [newSyncState, syncMessage] = Automerge.generateSyncMessage(doc, syncState);

        this.syncStates.set(peerId, newSyncState);

        if (syncMessage) {
            const message: PeerMessage = {
                type: 'crdt-sync',
                docId: DOC_PREFIX_ROOT,
                data: bytesToBase64(syncMessage),
            };
            this.peerManager.sendCrdtSync(peerId, message);
        }
    }

    /** Generate and send sync messages to all connected peers. */
    private sendSyncToAllPeers(): void {
        for (const peerId of this.peerManager.getConnectedPeerIds()) {
            this.sendSyncToPeer(peerId);
        }
    }
}

function bytesToBase64(bytes: Uint8Array): string {
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
