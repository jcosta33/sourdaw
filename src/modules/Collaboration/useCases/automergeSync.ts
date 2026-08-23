import {
    type Doc,
    type Heads,
    type Patch,
    type SyncState,
    change,
    clone,
    diff,
    getHeads,
    initSyncState,
    generateSyncMessage,
    receiveSyncMessage,
    view,
} from '@automerge/automerge';

import { logger } from '#/infra/logger/appLogger';
import { syncActionReplayMetadata } from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    subscribeToCrdtChanges,
    getCrdtDoc,
    createCrdtDoc,
    replaceCrdtDoc,
    removeCrdtDoc,
    hasCrdtDoc,
    getCrdtDocIds,
    persistCrdtProject,
    runCrdtPersistenceBarrier,
    sanitizeIncomingCrdtDocument,
    waitForCrdtDocumentTransition,
    DOC_PREFIX_ROOT,
    DOC_BRANCHES,
} from '#/modules/CrdtDocument/useCases';
import { readSettledProjectId, type SettledProjectIdentity } from '#/modules/Project/stores';
import { base64ToBytes, bytesToBase64 } from '#/utils/base64';

import { type PeerId, type PeerMessage } from '../models/CollaborationTypes';

type PeerSyncTransport = {
    getConnectedPeerIds: () => PeerId[];
    /**
     * Hand a message to the transport. The returned promise settles when the
     * transport has actually taken every byte — `send()` returning is not the
     * same as the peer having the changes, so this is the only signal a
     * SyncState may advance on.
     */
    sendCrdtSync: (input: { peerId: PeerId; message: PeerMessage }) => Promise<void> | void;
};

// Branch-content docs share a `branch_<id>` id scheme minted by CrdtDocument's
// crdtBranching (forkProjectBranch). CrdtDocument exposes no constant for the
// prefix, so the routing predicate keeps a local one.
const DOC_PREFIX_BRANCH = 'branch_';

/**
 * Top-level slot of the root document that backs the action-replay capability
 * table. `actionHistoryStore` is built with
 * `createAutomergeStorage(DOC_PREFIX_ROOT, 'actionHistory')`, and
 * `createAutomergeStorage` writes each slot as a top-level document key — so no
 * other document and no other slot can invalidate a replay capability.
 */
const ACTION_HISTORY_SLOT = 'actionHistory';

/**
 * Why sanitation gets retried at all.
 *
 * Sanitation failure is a property of the *moment*, not of the content.
 * `sanitizeIncomingCrdtDocument` can only throw out of Automerge's `save`,
 * `load` and `change`: the shape check it wraps,
 * `sanitize_action_history_state`, contains no `throw` at all and returns a
 * value for every hostile shape it is handed. So what fails here is a wasm
 * allocation during a full serialize-plus-deserialize of the entire project
 * document — a fault whose likelihood rises with project size and memory
 * pressure, and which the same bytes can survive on a later try. Closing the
 * channel on the first one let one allocation spike cost a peer for the rest
 * of the session.
 *
 * The two bounds below cover the two shapes that has:
 *
 * Attempts per delivery — the merged document is already in hand, so the
 * cheapest retry is right here. `save()` claims a buffer the size of the
 * whole document; when that claim fails the partial work is released, so a
 * second attempt runs against a heap the first one just freed. A third
 * against the same bytes in the same tick buys nothing, so two.
 */
const SANITATION_ATTEMPTS_PER_DELIVERY = 2;

/**
 * Deliveries in a row that failed every attempt, before the channel is
 * closed. Any delivery that sanitizes clears the streak, so faults separated
 * by working traffic — an isolated one now and another an hour later — never
 * add up to a close.
 *
 * Three, because sustained memory pressure outlives a single tick: a channel
 * that has failed three separate merges has failed at three separate moments,
 * which is enough to tell a spike from a document this node cannot read, and
 * low enough that the unreadable case costs a bounded number of
 * project-sized save/load attempts before the exchange stops.
 */
const MAX_SANITATION_FAILURES = 3;

function haveSameHeads(left: Heads, right: Heads): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const sorted_left = [...left].sort();
    const sorted_right = [...right].sort();
    return sorted_left.every((hash, index) => hash === sorted_right[index]);
}

type TouchesActionHistoryInput = {
    docId: string;
    beforeHeads: Heads;
    syncedDoc: Doc<unknown>;
};

/**
 * CC-3 — how much replay authority a received sync is allowed to invalidate.
 *
 * The previous behaviour cleared every capability and tombstone on every
 * inbound message, so a peer's unrelated edit (or an empty sync round) made
 * every history-panel revert inert for the rest of the session. Replay
 * authority can only be affected by a change to the root document's
 * `actionHistory` slot, so that is the only thing worth reacting to.
 */
function touchesActionHistory({ docId, beforeHeads, syncedDoc }: TouchesActionHistoryInput): boolean {
    if (docId !== DOC_PREFIX_ROOT) {
        return false;
    }

    const after_heads = getHeads(syncedDoc);
    if (haveSameHeads(beforeHeads, after_heads)) {
        // A no-op sync round moved nothing.
        return false;
    }

    let patches: Patch[];
    try {
        patches = diff(syncedDoc, beforeHeads, after_heads);
    } catch (error) {
        // The document cannot span both head sets (a peer replaced the
        // lineage wholesale). No slot evidence is available, so reconcile
        // conservatively against whatever history the sync leaves behind.
        logger.warn('[AutomergeSync] Could not diff a received root sync; reconciling all replay entries', error);
        return true;
    }

    return patches.some((patch) => patch.path[0] === ACTION_HISTORY_SLOT);
}

/**
 * Optional hooks supplied by the session layer so AutomergeSync can enforce
 * an edit boundary and surface persistence failures without importing the
 * collaboration store or permission manager directly.
 */
export type AutomergeSyncHooks = {
    /** Bind structural host authority and canonical identity at delivery acceptance time. */
    captureSyncAcceptance?: (input: { peerId: PeerId; docId: string }) => {
        accepted: boolean;
        senderIsHost: boolean;
        protectedProjectIdentity?: SettledProjectIdentity;
    };
    /**
     * Gate applied before a received project sync is written into the
     * repository. Return `false` to drop the sync. When omitted, all syncs
     * are applied.
     *
     * This is a per-document routing gate, not a permission system: the only
     * production caller uses it to keep `__branches__` host-authoritative.
     * Peers otherwise have unconditional write access — see `generateInvite`.
     */
    canApplySync?: (peerId: PeerId, docId: string) => boolean;
    /** Called after a received sync has replaced the authoritative document. */
    onSyncApplied?: (input: { peerId: PeerId; docId: string }) => void;
    /** Called once the installed document heads equal the heads advertised by this peer. */
    onSyncConverged?: (input: { peerId: PeerId; docId: string }) => void;
    /** Return the host-owned project identity a non-host root delivery may not replace. */
    getProtectedProjectId?: (input: { peerId: PeerId; docId: string }) => string | undefined;
    /** Prepare durable side effects against the exact root revision before it is persisted. */
    prepareSyncPersistence?: (input: {
        peerId: PeerId;
        docId: string;
        projectId?: string;
        rootHeads: readonly string[];
        senderIsHost: boolean;
    }) => Promise<(() => Promise<void>) | undefined> | (() => Promise<void>) | undefined;
    /** Called when a prepared side effect fails after document persistence. */
    onPostPersistError?: (error: unknown) => void;
    /** Called when an async persist after a received sync fails. */
    onPersistError?: (error: unknown) => void;
    /**
     * Called when a generated sync message could not be delivered. The peer's
     * SyncState is left untouched so the message will be regenerated, but the
     * session is out of sync until it is — silence here is the difference
     * between a retryable fault and "connected but permanently unsynced".
     */
    onSendError?: (input: { peerId: PeerId; docId: string; error: unknown }) => void;
    /**
     * Called when one peer's sync channel for a document is quarantined after
     * repeated sanitation failures. The channel is knowingly divergent from
     * that point on and nothing short of that peer going away reopens it, so
     * this is a session-level fault the musician has to be told about — not a
     * log line, and not a message in a slot that routine traffic overwrites.
     */
    onSyncQuarantine?: (input: { peerId: PeerId; docId: string; error: unknown }) => void;
    /**
     * Called when the quarantines held against a peer are lifted because the
     * peer is really gone. Pairs with `onSyncQuarantine`: whatever the session
     * layer put up to describe the divergence has to come down with it.
     */
    onSyncQuarantineLifted?: (input: { peerId: PeerId }) => void;
};

function protectProjectIdentity(document: Doc<unknown>, identity: SettledProjectIdentity | undefined): Doc<unknown> {
    if (!identity) {
        return document;
    }
    const projectMeta = (document as Doc<Record<string, unknown>>).projectMeta;
    if (readSettledProjectId(projectMeta) === identity.projectId) {
        return document;
    }
    return change(document as Doc<Record<string, unknown>>, 'Preserve host project identity', (draft) => {
        const current = draft.projectMeta;
        if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
            (current as Record<string, unknown>).projectId = identity.projectId;
            delete (current as Record<string, unknown>).identityMigrationPending;
        } else {
            draft.projectMeta = { projectId: identity.projectId };
        }
    });
}

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
    /** Tail of the in-flight sync generation per `${peerId} ${docId}`. */
    private sendQueues = new Map<string, Promise<void>>();
    private peerManager: PeerSyncTransport;
    private unsubscribeFromChanges: (() => void) | null = null;
    private hooks: AutomergeSyncHooks;
    /**
     * Guard set while a received remote sync is being written into the
     * repository. The change subscription checks it and skips re-broadcasting
     * so a received sync doesn't bounce straight back to every peer (mirrors
     * the isProjectingBranches pattern in sessionManagement).
     */
    private isApplyingRemoteSync = false;
    /**
     * Sync channels closed after repeated sanitation failures, keyed
     * `${peerId} ${docId}` — see `closeSyncChannel`.
     */
    private quarantinedChannels = new Set<string>();
    /**
     * Consecutive sanitation failures per `${peerId} ${docId}`. An entry only
     * exists while a channel is mid-streak: any delivery that sanitizes
     * deletes it, so faults separated by successful traffic never add up.
     */
    private sanitationFailures = new Map<string, number>();
    private persistenceTail = Promise.resolve();
    private persistenceBarrierCount = 0;
    private lifecycleGeneration = 0;

    constructor(peerManager: PeerSyncTransport, hooks: AutomergeSyncHooks = {}) {
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
        this.lifecycleGeneration += 1;
        if (this.unsubscribeFromChanges) {
            this.unsubscribeFromChanges();
            this.unsubscribeFromChanges = null;
        }
        this.syncStates.clear();
        this.sendQueues.clear();
        this.quarantinedChannels.clear();
        this.sanitationFailures.clear();
    }

    /** Wait for every received document persistence and prepared post-persist handoff. */
    async flushPersistence(): Promise<void> {
        for (;;) {
            const tail = this.persistenceTail;
            await tail;
            await Promise.resolve();
            if (tail === this.persistenceTail && this.persistenceBarrierCount === 0) {
                return;
            }
        }
    }

    private static channelKey(peerId: PeerId, docId: string): string {
        return `${peerId} ${docId}`;
    }

    /** Initialize sync state for a new peer and send initial sync. */
    addPeer(peerId: PeerId): void {
        this.syncStates.set(peerId, new Map());
        this.sendSyncToPeer(peerId);
    }

    /**
     * Drop the protocol state held for a peer that has stopped responding.
     *
     * Deliberately does **not** touch the quarantine. This runs from the
     * immediate disconnect path, which also fires on
     * `connectionState === 'disconnected'` — a state W3C WebRTC defines as
     * transient and ICE recovers from without the data channel ever closing.
     * Lifting a quarantine here meant a Wi-Fi flap replayed the whole failing
     * exchange — a full document merge plus a project-sized save/load on the
     * main thread — and re-armed the quarantine, on every flap. In a DAW that
     * stall is audible. `forgetPeer` is the durable decision.
     */
    removePeer(peerId: PeerId): void {
        this.syncStates.delete(peerId);
        for (const key of this.sendQueues.keys()) {
            if (key.startsWith(`${peerId} `)) {
                this.sendQueues.delete(key);
            }
        }
    }

    /**
     * Forget everything held for a peer that is really gone.
     *
     * Rejoining is the way out of a quarantine, so the channel has to reopen
     * when the peer actually leaves — but only then, which is why this is a
     * separate entry point from `removePeer`.
     */
    forgetPeer(peerId: PeerId): void {
        this.removePeer(peerId);

        let lifted_any = false;
        for (const key of this.quarantinedChannels) {
            if (key.startsWith(`${peerId} `)) {
                this.quarantinedChannels.delete(key);
                lifted_any = true;
            }
        }
        for (const key of this.sanitationFailures.keys()) {
            if (key.startsWith(`${peerId} `)) {
                this.sanitationFailures.delete(key);
            }
        }

        if (lifted_any) {
            this.hooks.onSyncQuarantineLifted?.({ peerId });
        }
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
        if (!isKnownDocId(docId)) {
            logger.warn('[AutomergeSync] Dropping sync for unknown docId from peer', peerId, docId);
            return;
        }
        if (this.quarantinedChannels.has(AutomergeSync.channelKey(peerId, docId))) {
            return;
        }
        const captured = this.hooks.captureSyncAcceptance?.({ peerId, docId });
        const accepted = captured?.accepted ?? !(this.hooks.canApplySync && !this.hooks.canApplySync(peerId, docId));
        if (!accepted) {
            logger.warn('[AutomergeSync] Dropping sync rejected by canApplySync', peerId, docId);
            return;
        }
        this.receiveAcceptedSync({
            peerId,
            docId,
            syncMessageBase64,
            generation: this.lifecycleGeneration,
            acceptance: {
                senderIsHost: captured?.senderIsHost ?? false,
                protectedProjectIdentity:
                    captured?.protectedProjectIdentity ??
                    (docId === DOC_PREFIX_ROOT
                        ? (() => {
                              const projectId = this.hooks.getProtectedProjectId?.({ peerId, docId });
                              return projectId ? { projectId } : undefined;
                          })()
                        : undefined),
            },
        });
    }

    private receiveAcceptedSync({
        peerId,
        docId,
        syncMessageBase64,
        generation,
        acceptance,
    }: {
        peerId: PeerId;
        docId: string;
        syncMessageBase64: string;
        generation: number;
        acceptance: { senderIsHost: boolean; protectedProjectIdentity?: SettledProjectIdentity };
    }): void {
        if (generation !== this.lifecycleGeneration) {
            return;
        }
        if (this.persistenceBarrierCount > 0) {
            const barrier = this.persistenceTail;
            void barrier.then(() => {
                this.receiveAcceptedSync({ peerId, docId, syncMessageBase64, generation, acceptance });
            });
            return;
        }

        const transition = waitForCrdtDocumentTransition(docId);
        if (transition) {
            void transition.then((outcome) => {
                if (outcome === 'committed' && generation === this.lifecycleGeneration) {
                    this.receiveAcceptedSync({ peerId, docId, syncMessageBase64, generation, acceptance });
                }
                return undefined;
            });
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
        // Captured before the merge so the applied change set can be measured.
        const before_heads = getHeads(doc);

        let newDoc: Doc<unknown>;
        let newSyncState: SyncState;
        try {
            const syncMessage = base64ToBytes(syncMessageBase64);
            [newDoc, newSyncState] = receiveSyncMessage(clone(doc), syncState, syncMessage);
        } catch (error) {
            logger.warn('[AutomergeSync] Malformed sync message from peer', peerId, error);
            return;
        }

        // A failed `sanitizeIncomingCrdtDocument` leaves `newDoc` untouched —
        // it throws out of `save`, out of `load`, or out of a `change` against
        // the freshly loaded copy — so the merged document in hand is still
        // the right input for a second attempt.
        let sanitized_doc: Doc<unknown> | null = null;
        let sanitation_error: unknown = null;
        for (let attempt = 0; attempt < SANITATION_ATTEMPTS_PER_DELIVERY; attempt++) {
            try {
                sanitized_doc = sanitizeIncomingCrdtDocument(newDoc);
                break;
            } catch (error) {
                sanitation_error = error;
            }
        }

        if (sanitized_doc === null) {
            this.handleSanitationFailure({
                peerId,
                docId,
                peerStates,
                mergedDoc: newDoc,
                beforeHeads: before_heads,
                error: sanitation_error,
            });
            return;
        }
        sanitized_doc = protectProjectIdentity(
            sanitized_doc,
            docId === DOC_PREFIX_ROOT ? acceptance.protectedProjectIdentity : undefined
        );

        // A delivery that sanitizes ends the streak. The bound exists for
        // isolated allocation faults, so faults separated by working traffic
        // must never accumulate into a close.
        this.sanitationFailures.delete(AutomergeSync.channelKey(peerId, docId));

        // CC-3 — decide what this sync is allowed to invalidate *before* the
        // repository moves, while `doc` still holds the pre-sync heads.
        const reconciles_replay_authority = touchesActionHistory({
            docId,
            beforeHeads: before_heads,
            syncedDoc: sanitized_doc,
        });

        const documentChanged = !haveSameHeads(before_heads, getHeads(sanitized_doc));
        const converged = Boolean(
            newSyncState.theirHeads && haveSameHeads(getHeads(sanitized_doc), newSyncState.theirHeads)
        );
        if (!documentChanged && this.hooks.prepareSyncPersistence !== undefined) {
            peerStates.set(docId, newSyncState);
            this.syncStates.set(peerId, peerStates);
            if (converged) {
                this.hooks.onSyncConverged?.({ peerId, docId });
            }
            return;
        }

        const rootHeads =
            docId === DOC_PREFIX_ROOT ? [...getHeads(sanitized_doc)].map(String).toSorted() : ([] as string[]);
        const projectId =
            docId === DOC_PREFIX_ROOT
                ? readSettledProjectId((sanitized_doc as Doc<Record<string, unknown>>).projectMeta)
                : undefined;

        const publish = () => {
            peerStates.set(docId, newSyncState);
            this.syncStates.set(peerId, peerStates);
            this.isApplyingRemoteSync = true;
            try {
                replaceCrdtDoc({ id: docId, doc: sanitized_doc });
            } finally {
                this.isApplyingRemoteSync = false;
            }
            if (documentChanged) {
                this.hooks.onSyncApplied?.({ peerId, docId });
            }
            if (converged) {
                this.hooks.onSyncConverged?.({ peerId, docId });
            }
            if (reconciles_replay_authority) {
                syncActionReplayMetadata(actionHistoryStore.value?.entries ?? []);
            }
        };

        const holdsRootPersistenceBarrier =
            docId === DOC_PREFIX_ROOT && this.hooks.prepareSyncPersistence !== undefined;
        if (holdsRootPersistenceBarrier) {
            this.persistenceBarrierCount += 1;
            let retryAgainstNewerLocalRoot = false;
            const persistence = runCrdtPersistenceBarrier(async ({ persistCurrentProject }) => {
                if (generation !== this.lifecycleGeneration) {
                    return;
                }
                let afterPersist: (() => Promise<void>) | undefined;
                try {
                    afterPersist = await this.hooks.prepareSyncPersistence?.({
                        peerId,
                        docId,
                        projectId,
                        rootHeads,
                        senderIsHost: acceptance.senderIsHost,
                    });
                    if (generation !== this.lifecycleGeneration) {
                        return;
                    }
                    const currentHeads = getCrdtDoc(DOC_PREFIX_ROOT);
                    if (!currentHeads || !haveSameHeads(before_heads, getHeads(currentHeads))) {
                        retryAgainstNewerLocalRoot = true;
                        return;
                    }
                    publish();
                    await persistCurrentProject(rootHeads);
                } catch (error) {
                    logger.warn('[AutomergeSync] Failed to persist after receiving sync:', error);
                    this.hooks.onPersistError?.(error);
                    return;
                }
                if (!afterPersist) {
                    return;
                }
                try {
                    await afterPersist();
                } catch (error) {
                    logger.warn('[AutomergeSync] Post-persist synchronization failed:', error);
                    this.hooks.onPostPersistError?.(error);
                }
            });
            this.persistenceTail = persistence.finally(() => {
                this.persistenceBarrierCount -= 1;
                if (retryAgainstNewerLocalRoot && generation === this.lifecycleGeneration) {
                    this.receiveAcceptedSync({ peerId, docId, syncMessageBase64, generation, acceptance });
                }
            });
            return;
        }

        publish();
        const persistence = this.persistenceTail.then(async () => {
            try {
                await persistCrdtProject(docId === DOC_PREFIX_ROOT ? rootHeads : undefined);
            } catch (error) {
                logger.warn('[AutomergeSync] Failed to persist after receiving sync:', error);
                this.hooks.onPersistError?.(error);
            }
        });
        this.persistenceTail = persistence;
    }

    /**
     * Handle a merged document that failed sanitation.
     *
     * By the time sanitation runs, `receiveSyncMessage` has already merged
     * the peer's changes into the document's underlying handle and marked the
     * document it was handed as outdated — so returning early is not a
     * rejection. It leaves the repository holding an outdated document, and
     * every later sync for that document, from any peer, then dies in the
     * malformed-message catch with `RangeError: Attempting to change an
     * outdated document`. One failed message stops that document syncing for
     * the rest of the session, silently.
     *
     * So every failed delivery, retried or final, does two things:
     *
     *  - Roll the document back to its pre-sync state, so the content that
     *    failed never reaches project truth, the store projections or
     *    persistence, and the repository stops holding an outdated handle.
     *  - Drop the channel's SyncState. It describes an exchange whose result
     *    was thrown away, so keeping it would leave this node claiming to
     *    hold changes it discarded. The reply generated afterwards
     *    re-advertises the rolled-back heads, which is what tells the peer
     *    those changes are still owed.
     *
     * Only once {@link MAX_SANITATION_FAILURES} deliveries in a row have
     * failed every attempt is the channel closed. A rollback that itself
     * fails skips the count and closes immediately: the repository is still
     * holding the outdated handle, nothing here can repair that, and it must
     * not pass as a clean rejection.
     */
    private handleSanitationFailure({
        peerId,
        docId,
        peerStates,
        mergedDoc,
        beforeHeads,
        error,
    }: {
        peerId: PeerId;
        docId: string;
        peerStates: PerDocSyncStateMap;
        mergedDoc: Doc<unknown>;
        beforeHeads: Heads;
        error: unknown;
    }): void {
        logger.warn('[AutomergeSync] Remote document sanitation failed', peerId, docId, error);

        peerStates.delete(docId);
        this.syncStates.set(peerId, peerStates);

        const rollback = this.rollBackSyncedDocument({ docId, mergedDoc, beforeHeads });
        if (rollback.status === 'failed') {
            logger.warn('[AutomergeSync] Could not roll back a failed document', peerId, docId, rollback.error);
            this.closeSyncChannel({ peerId, docId, error: rollback.error });
            return;
        }

        const key = AutomergeSync.channelKey(peerId, docId);
        const failures = (this.sanitationFailures.get(key) ?? 0) + 1;
        this.sanitationFailures.set(key, failures);

        if (failures >= MAX_SANITATION_FAILURES) {
            this.closeSyncChannel({ peerId, docId, error });
            return;
        }

        // Tell the peer where this node actually stands. Without it the peer
        // is left believing the discarded changes landed, and nothing in the
        // protocol would ever offer them again.
        this.queueDocSyncToPeer({ peerId, docId });
    }

    /**
     * Put the document back the way it was before this sync merged into it.
     *
     * A document with no pre-sync heads held nothing, and the honest
     * restoration of nothing is *absence*, not an empty document: this sync
     * path mints a document for a known-but-absent id (a branch or metadata
     * doc a peer is ahead of us on), and `clone(view(mergedDoc, []))` would
     * install a real empty one under that id. That document shows up in
     * `getCrdtDocIds()`, is swept out to every other peer, and is written to
     * IndexedDB and the saved bundle by the next persist — so a branch whose
     * content document fails on its first message would exist in the branch
     * list, open empty, and be saved that way.
     *
     * The root document is excluded because it is structural: this node
     * always holds one, so its pre-sync state is the empty document it had,
     * never absence.
     */
    private rollBackSyncedDocument({
        docId,
        mergedDoc,
        beforeHeads,
    }: {
        docId: string;
        mergedDoc: Doc<unknown>;
        beforeHeads: Heads;
    }): { status: 'rolled-back' } | { status: 'failed'; error: unknown } {
        const restore_to_absence = beforeHeads.length === 0 && docId !== DOC_PREFIX_ROOT;

        try {
            const restored_doc = restore_to_absence ? null : clone(view(mergedDoc, beforeHeads));
            // Same guard as a normal apply: installing the rollback must not
            // echo a sync back to every peer.
            this.isApplyingRemoteSync = true;
            try {
                if (restored_doc === null) {
                    removeCrdtDoc(docId);
                } else {
                    replaceCrdtDoc({ id: docId, doc: restored_doc });
                }
            } finally {
                this.isApplyingRemoteSync = false;
            }
            if (restored_doc === null) {
                this.forgetDocumentSyncState(docId);
            }
            return { status: 'rolled-back' };
        } catch (rollbackError) {
            return { status: 'failed', error: rollbackError };
        }
    }

    /**
     * Drop every peer's protocol state for a document that no longer exists.
     *
     * A SyncState asserts that both sides already agreed on changes; keeping
     * one for an id that has been rolled back to absence would let a later
     * re-creation of that id skip exactly the changes it needs to be filled
     * with. A queued generation for it would run against the same stale
     * agreement.
     */
    private forgetDocumentSyncState(docId: string): void {
        for (const peerStates of this.syncStates.values()) {
            peerStates.delete(docId);
        }
        for (const key of this.sendQueues.keys()) {
            if (key.endsWith(` ${docId}`)) {
                this.sendQueues.delete(key);
            }
        }
    }

    /**
     * Close one (peer, document) sync channel for good.
     *
     * Automerge's sync protocol has no way to say "I refuse these changes":
     * any truthful reply advertises heads that still lack them, which invites
     * the peer to send them again. Once the bound is spent, staying in the
     * exchange can only repeat the failure, so this peer and this document
     * stop exchanging in both directions — and the divergence is reported,
     * because a divergence nobody is told about is the outcome this whole
     * path exists to prevent.
     *
     * The quarantine is per (peer, document): the peer keeps syncing every
     * other document, and every other peer keeps syncing this one. Only
     * `forgetPeer` lifts it, so the peer really going away and rejoining is
     * the recovery path.
     */
    private closeSyncChannel({ peerId, docId, error }: { peerId: PeerId; docId: string; error: unknown }): void {
        const key = AutomergeSync.channelKey(peerId, docId);
        logger.warn('[AutomergeSync] Quarantining a peer sync channel', peerId, docId, error);
        this.quarantinedChannels.add(key);
        this.sanitationFailures.delete(key);
        this.hooks.onSyncQuarantine?.({ peerId, docId, error });
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
        this.queueDocSyncToPeer({ peerId, docId: DOC_PREFIX_ROOT });

        // Sync branch metadata doc if it exists (session-scoped)
        if (hasCrdtDoc(DOC_BRANCHES)) {
            this.queueDocSyncToPeer({ peerId, docId: DOC_BRANCHES });
        }

        // Sync branch content docs
        for (const docId of getCrdtDocIds()) {
            if (docId.startsWith(DOC_PREFIX_BRANCH)) {
                this.queueDocSyncToPeer({ peerId, docId });
            }
        }
    }

    /**
     * Serialize sync generation per (peer, document).
     *
     * A SyncState now advances only after its message is on the wire, so a
     * second generation started while the first is still sending would run
     * against a state that is about to move — producing a duplicate message and
     * committing the two results out of order.
     */
    private queueDocSyncToPeer({ peerId, docId }: { peerId: PeerId; docId: string }): void {
        const key = AutomergeSync.channelKey(peerId, docId);
        // Nothing is generated for a closed channel: this peer and this
        // document can no longer converge, so continuing to send is waste.
        if (this.quarantinedChannels.has(key)) {
            return;
        }
        const previous = this.sendQueues.get(key) ?? Promise.resolve();
        const next = previous.then(() => this.sendDocSyncToPeer({ peerId, docId }));
        const settled = next.catch((error: unknown) => {
            logger.warn('[AutomergeSync] Sync generation failed', peerId, docId, error);
        });
        this.sendQueues.set(key, settled);
        void settled.then(() => {
            // Only the tail may be dropped; a newer queue entry must survive.
            if (this.sendQueues.get(key) === settled) {
                this.sendQueues.delete(key);
            }
        });
    }

    /** Generate and send a sync message for one document to one peer. */
    private async sendDocSyncToPeer({ peerId, docId }: { peerId: PeerId; docId: string }): Promise<void> {
        // Re-checked here, not only at queue time: a generation queued while
        // the channel was open runs a turn later, and the channel can close in
        // between — the last failed delivery queues a reply and the next one
        // quarantines. A closed channel must not emit that reply.
        if (this.quarantinedChannels.has(AutomergeSync.channelKey(peerId, docId))) {
            return;
        }

        const doc = getCrdtDoc(docId);
        if (!doc) {
            return;
        }

        const peerStates = this.syncStates.get(peerId) ?? new Map<string, SyncState>();
        const syncState = peerStates.get(docId) ?? initSyncState();

        const [newSyncState, syncMessage] = generateSyncMessage(doc, syncState);

        if (!syncMessage) {
            // Nothing to deliver, so there is no delivery to order against.
            peerStates.set(docId, newSyncState);
            this.syncStates.set(peerId, peerStates);
            return;
        }

        const message: PeerMessage = {
            type: 'crdt-sync',
            docId,
            data: bytesToBase64(syncMessage),
        };

        try {
            await this.peerManager.sendCrdtSync({ peerId, message });
        } catch (error) {
            // The peer never received these changes. Leaving its SyncState
            // where it was is what makes the failure retryable: the next
            // generation reproduces this exact message instead of skipping it
            // as already delivered.
            logger.warn('[AutomergeSync] Failed to send a sync message to peer', peerId, docId, error);
            this.hooks.onSendError?.({ peerId, docId, error });
            return;
        }

        peerStates.set(docId, newSyncState);
        this.syncStates.set(peerId, peerStates);
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
            this.queueDocSyncToPeer({ peerId, docId });
        }
    }
}
