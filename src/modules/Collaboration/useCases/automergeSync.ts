import {
    type Doc,
    type SyncState,
    type SyncMessage,
    initSyncState,
    generateSyncMessage,
    receiveSyncMessage,
} from '@automerge/automerge';

import { logger } from '#/infra/logger/appLogger';
import {
    subscribeToCrdtChanges,
    getCrdtDoc,
    createCrdtDoc,
    replaceCrdtDoc,
    hasCrdtDoc,
    getCrdtDocIds,
    persistCrdtProject,
    DOC_PREFIX_ROOT,
    DOC_BRANCHES,
} from '#/modules/CrdtDocument/useCases';
import { base64ToBytes, bytesToBase64 } from '#/utils/base64';

import { type PeerId, type PeerMessage } from '../models/CollaborationTypes';
import { type PeerConnectionManager } from '../repositories/peerConnection';

// Branch-content docs share a `branch_<id>` id scheme minted by CrdtDocument's
// crdtBranching (forkProjectBranch). CrdtDocument exposes no constant for the
// prefix, so the routing predicate keeps a local one.
const DOC_PREFIX_BRANCH = 'branch_';

/**
 * Optional hooks supplied by the session layer so AutomergeSync can enforce
 * an edit boundary and surface persistence failures without importing the
 * collaboration store or permission manager directly.
 */
export type AutomergeSyncHooks = {
    /**
     * Gate applied before a received project sync is written into the
     * repository. Return `false` to drop the sync (e.g. the sender is a
     * viewer with no edit capability). When omitted, all syncs are applied.
     */
    canApplySync?: (peerId: PeerId, docId: string) => boolean;
    /** Called when an async persist after a received sync fails. */
    onPersistError?: (error: unknown) => void;
};

/**
 * Whether `docId` names a document this node is willing to host. We only
 * accept syncs for the root project doc, the session branch-metadata doc,
 * and branch content docs — never an arbitrary doc minted by a remote peer.
 */
function isKnownDocId(docId: string): boolean {
    return docId === DOC_PREFIX_ROOT || docId === DOC_BRANCHES || docId.startsWith(DOC_PREFIX_BRANCH);
}

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
    private hooks: AutomergeSyncHooks;
    /**
     * Guard set while a received remote sync is being written into the
     * repository. The change subscription checks it and skips re-broadcasting
     * so a received sync doesn't bounce straight back to every peer (mirrors
     * the isProjectingBranches pattern in sessionManagement).
     */
    private isApplyingRemoteSync = false;

    constructor(peerManager: PeerConnectionManager, hooks: AutomergeSyncHooks = {}) {
        this.peerManager = peerManager;
        this.hooks = hooks;
    }

    /** Start syncing: subscribe to local document changes. */
    start(): void {
        // Idempotent: a second start() must not leak the prior subscription.
        // Tear the existing one down before re-subscribing.
        if (this.unsubscribeFromChanges) {
            this.unsubscribeFromChanges();
            this.unsubscribeFromChanges = null;
        }
        this.unsubscribeFromChanges = subscribeToCrdtChanges((docId) => {
            // While applying a received remote sync, the resulting repository
            // change must not be re-broadcast — that would echo every received
            // message back to all peers and form a sync loop.
            if (this.isApplyingRemoteSync) {
                return;
            }
            // §138.1 — If the repository tells us which doc changed,
            // skip the per-peer generateSyncMessage for every other
            // doc and only sync the one that actually moved. Bulk
            // operations (no hint) still fall back to the full sweep.
            if (docId !== undefined) {
                this.sendDocSyncToAllPeers(docId);
            } else {
                this.sendSyncToAllPeers();
            }
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
        // Only accept syncs for documents this node is willing to host. A
        // remote peer must not be able to mint arbitrary docs in our
        // repository (which the next persist would write to IDB).
        if (!isKnownDocId(docId)) {
            logger.warn('[AutomergeSync] Dropping sync for unknown docId from peer', peerId, docId);
            return;
        }

        // Edit boundary: a peer without edit capability (e.g. a viewer) must
        // not be able to mutate the project via the sync channel.
        if (this.hooks.canApplySync && !this.hooks.canApplySync(peerId, docId)) {
            logger.warn('[AutomergeSync] Dropping sync from peer without edit capability', peerId, docId);
            return;
        }

        let doc = getCrdtDoc(docId);
        if (!doc) {
            // Known-but-absent doc — peer is syncing a branch or metadata doc
            // we don't have yet. Initialize empty and let the sync fill it in.
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
            logger.warn('[AutomergeSync] Malformed sync message from peer', peerId, error);
            return;
        }

        peerStates.set(docId, newSyncState);
        this.syncStates.set(peerId, peerStates);

        // Update the document in the repository.
        // This triggers onChange → hydration. Guard the broadcast so the
        // resulting change isn't echoed straight back to every peer.
        this.isApplyingRemoteSync = true;
        try {
            replaceCrdtDoc({ id: docId, doc: newDoc });
        } finally {
            this.isApplyingRemoteSync = false;
        }

        // Persist asynchronously — don't block the sync loop.
        persistCrdtProject().catch((error) => {
            logger.warn('[AutomergeSync] Failed to persist after receiving sync:', error);
            this.hooks.onPersistError?.(error);
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
            if (docId.startsWith(DOC_PREFIX_BRANCH)) {
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

    /**
     * §138.1 — Fast path for single-doc mutations: only invoke
     * generateSyncMessage for the doc that actually changed, across all
     * connected peers. Cuts per-edit work from O(peers × docs) to
     * O(peers × 1).
     */
    private sendDocSyncToAllPeers(docId: string): void {
        for (const peerId of this.peerManager.getConnectedPeerIds()) {
            this.sendDocSyncToPeer({ peerId, docId });
        }
    }
}
