import {
    type Doc,
    type SyncState,
    type SyncMessage,
    initSyncState,
    generateSyncMessage,
    receiveSyncMessage,
} from '@automerge/automerge';

import {
    subscribeToCrdtChanges,
    getCrdtDoc,
    createCrdtDoc,
    replaceCrdtDoc,
    hasCrdtDoc,
    getCrdtDocIds,
    persistCrdtProject,
} from '#/modules/CrdtDocument';
import { type PeerId, type PeerMessage } from '../models/CollaborationTypes';
import { type PeerConnectionManager } from '../repositories/peerConnection';

const DOC_PREFIX_ROOT = 'root';
const DOC_BRANCHES = '__branches__';

// Sync state is per-peer per-doc: each document requires its own Automerge SyncState.
type PerDocSyncStateMap = Map<string, SyncState>;
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
        this.unsubscribeFromChanges = subscribeToCrdtChanges(() => {
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
    receiveSync({
        peerId,
        docId,
        syncMessageBase64,
    }: {
        peerId: PeerId;
        docId: string;
        syncMessageBase64: string;
    }): void {
        let doc = getCrdtDoc(docId);
        if (!doc) {
            // Unknown doc — peer is syncing a branch or metadata doc we don't have yet.
            // Initialize empty and let the sync message fill it in.
            createCrdtDoc(docId);
            doc = getCrdtDoc(docId)!;
        }

        const peerStates = this.syncStates.get(peerId) ?? new Map<string, SyncState>();
        const syncState = peerStates.get(docId) ?? initSyncState();

        let newDoc: Doc<unknown>;
        let newSyncState: SyncState;
        try {
            const syncMessage = base64ToBytes(syncMessageBase64);
            [newDoc, newSyncState] = receiveSyncMessage(doc, syncState, syncMessage as SyncMessage);
        } catch (error) {
            console.error('[AutomergeSync] Malformed sync message from peer', peerId, error);
            return;
        }

        peerStates.set(docId, newSyncState);
        this.syncStates.set(peerId, peerStates);

        // Update the document in the repository.
        // This triggers onChange → hydration + response sync messages.
        replaceCrdtDoc({ id: docId, doc: newDoc });

        // Persist asynchronously — don't block the sync loop.
        persistCrdtProject().catch((error) => {
            console.error('[AutomergeSync] Failed to persist after receiving sync:', error);
        });
    }

    /** Handle an incoming peer message. */
    handlePeerMessage({ peerId, message }: { peerId: PeerId; message: PeerMessage }): void {
        if (message.type === 'crdt-sync') {
            this.receiveSync({ peerId, docId: message.docId, syncMessageBase64: message.data });
        }
    }

    /** Generate and send sync messages to a specific peer for all known documents. */
    private sendSyncToPeer(peerId: PeerId): void {
        // Always sync the root project doc
        this.sendDocSyncToPeer({ peerId, docId: DOC_PREFIX_ROOT });

        // Sync branch metadata doc if it exists (session-scoped)
        if (hasCrdtDoc(DOC_BRANCHES)) {
            this.sendDocSyncToPeer({ peerId, docId: DOC_BRANCHES });
        }

        // Sync branch content docs
        for (const docId of getCrdtDocIds()) {
            if (docId.startsWith('branch_')) {
                this.sendDocSyncToPeer({ peerId, docId });
            }
        }
    }

    /** Generate and send a sync message for one document to one peer. */
    private sendDocSyncToPeer({ peerId, docId }: { peerId: PeerId; docId: string }): void {
        const doc = getCrdtDoc(docId);
        if (!doc) {
            return;
        }

        const peerStates = this.syncStates.get(peerId) ?? new Map<string, SyncState>();
        const syncState = peerStates.get(docId) ?? initSyncState();

        const [newSyncState, syncMessage] = generateSyncMessage(doc, syncState);

        peerStates.set(docId, newSyncState);
        this.syncStates.set(peerId, peerStates);

        if (syncMessage) {
            const message: PeerMessage = {
                type: 'crdt-sync',
                docId,
                data: bytesToBase64(syncMessage),
            };
            this.peerManager.sendCrdtSync({ peerId, message });
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
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
