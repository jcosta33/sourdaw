import * as Automerge from '@automerge/automerge';

import { DOC_PREFIX_ROOT, DOC_BRANCHES } from '#/modules/CrdtDocument/models/CrdtDocumentTypes';
import { automergeRepository } from '#/modules/CrdtDocument/repositories/automergeRepository';
import { persistCrdtProject } from '#/modules/CrdtDocument/useCases/crdtProjectLifecycle';

import { type PeerId, type PeerMessage } from '../models/CollaborationTypes';
import { type PeerConnectionManager } from '../repositories/peerConnection';

// Sync state is per-peer per-doc: each document requires its own Automerge SyncState.
type PerDocSyncStateMap = Map<string, Automerge.SyncState>;
type SyncStateMap = Map<PeerId, PerDocSyncStateMap>;

/**
 * Manages the Automerge sync protocol for all connected peers.
 *
 * Each peer has its own SyncState per document that tracks what they've seen.
 * When any local document changes, we generate sync messages for each peer.
 * When we receive a sync message, we apply it and hydrate stores.
 *
 * Documents synced:
 *  - `root` — the primary project document
 *  - `__branches__` — session-scoped branch metadata (created/removed by sessionManagement)
 *  - `branch_*` — branch content documents (created by crdtBranching)
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
        this.syncStates.set(peerId, new Map());
        this.sendSyncToPeer(peerId);
    }

    /** Remove sync state for a disconnected peer. */
    removePeer(peerId: PeerId): void {
        this.syncStates.delete(peerId);
    }

    /** Handle an incoming CRDT sync message from a peer. */
    receiveSync(peerId: PeerId, docId: string, syncMessageBase64: string): void {
        let doc = automergeRepository.getDoc(docId);
        if (!doc) {
            // Unknown doc — peer is syncing a branch or metadata doc we don't have yet.
            // Initialize empty and let the sync message fill it in.
            automergeRepository.createChildDoc(docId);
            doc = automergeRepository.getDoc(docId)!;
        }

        const peerStates = this.syncStates.get(peerId) ?? new Map<string, Automerge.SyncState>();
        const syncState = peerStates.get(docId) ?? Automerge.initSyncState();

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

        peerStates.set(docId, newSyncState);
        this.syncStates.set(peerId, peerStates);

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

    /** Generate and send sync messages to a specific peer for all known documents. */
    private sendSyncToPeer(peerId: PeerId): void {
        // Always sync the root project doc
        this.sendDocSyncToPeer(peerId, DOC_PREFIX_ROOT);

        // Sync branch metadata doc if it exists (session-scoped)
        if (automergeRepository.hasDoc(DOC_BRANCHES)) {
            this.sendDocSyncToPeer(peerId, DOC_BRANCHES);
        }

        // Sync branch content docs
        for (const docId of automergeRepository.getDocIds()) {
            if (docId.startsWith('branch_')) {
                this.sendDocSyncToPeer(peerId, docId);
            }
        }
    }

    /** Generate and send a sync message for one document to one peer. */
    private sendDocSyncToPeer(peerId: PeerId, docId: string): void {
        const doc = automergeRepository.getDoc(docId);
        if (!doc) {
            return;
        }

        const peerStates = this.syncStates.get(peerId) ?? new Map<string, Automerge.SyncState>();
        const syncState = peerStates.get(docId) ?? Automerge.initSyncState();

        const [newSyncState, syncMessage] = Automerge.generateSyncMessage(doc, syncState);

        peerStates.set(docId, newSyncState);
        this.syncStates.set(peerId, peerStates);

        if (syncMessage) {
            const message: PeerMessage = {
                type: 'crdt-sync',
                docId,
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
