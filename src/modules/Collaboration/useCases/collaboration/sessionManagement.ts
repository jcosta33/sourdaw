import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { cacheAudioBuffer, getAudioContext, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { branchStore, MAIN_BRANCH_ID } from '#/modules/CrdtDocument/stores';
import {
    setupProjectionBridge,
    subscribeToCrdtChanges,
    getCrdtDoc,
    createCrdtDoc,
    removeCrdtDoc,
    mutateCrdtDoc,
    persistCrdtProject,
    hasCrdtDoc,
    DOC_BRANCHES,
    preserveBranchStateForSession,
    replaceBranchState,
    restoreBranchStateAfterSession,
    waitForCrdtDocumentTransition,
    DOC_PREFIX_ROOT,
} from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { bytesToBase64 } from '#/utils/base64';
import { notifyUser } from '#/utils/Notification/notifyUser';

import {
    isAcceptablePeerId,
    type PeerId,
    type PeerMessage,
    PEER_COLORS,
    peerColorForIndex,
    type PresenceDelta,
    sanitizePeerColor,
    sanitizePeerName,
} from '../../models/CollaborationTypes';
import { DOC_ID_ASSET } from '../../models/SyncChannelConstants';
import { PeerConnectionManager } from '../../repositories/peerConnection';
import { collaborationStore } from '../../stores/collaborationStore';
import { AssetTransfer } from '../assetTransfer';
import { AutomergeSync, type AutomergeSyncHooks } from '../automergeSync';
import { type CollaborationPeer } from '../collaborationQueries';

import { clearCollaborationFailure } from './clearCollaborationFailure';
import { collaborationAssetOwnership } from './getCollaborationAssetOwnerId';

/**
 * §14.1 — Coalesce all collaboration-session mutables into one holder so the
 * session lives behind a single named handle and individual bindings can't
 * be reassigned from outside this file. Module-level \`let\`s here previously
 * covered 12 independent pieces of session state with no cross-referencing
 * discipline.
 *
 * Note on HMR: the holder-object pattern doesn't by itself make HMR-safe;
 * what it buys is: (1) encapsulation, (2) a single place to reset on
 * startSession/endSession, (3) no external mutation surface. A true
 * HMR-safe collaboration session needs externally-persistent state tied
 * to the WebRTC connection, which is a separate spec.
 */
const sessionState: {
    peerManager: PeerConnectionManager | null;
    automergeSync: AutomergeSync | null;
    assetTransfer: AssetTransfer | null;
    cleanupProjectionBridge: (() => void) | null;
    playheadBroadcastInterval: ReturnType<typeof setInterval> | null;
    /** Host-assigned peer slot ID for the in-flight invite, if any. */
    pendingInviteId: PeerId | null;
    /** Whether this session has durably preserved its local branch state. */
    hasBranchStateBackup: boolean;
    /** Unsubscribe from branchStore changes (local mutations → Automerge doc). */
    unsubscribeBranchStore: (() => void) | null;
    /** Unsubscribe from automergeRepository changes (__branches__ doc → branchStore). */
    unsubscribeAutomergeChanges: (() => void) | null;
    /**
     * Guard flag to prevent infinite update loop: projecting __branches__ →
     * branchStore triggers branchStore.subscribe, which must not write back.
     */
    isProjectingBranches: boolean;
    /** Canonical JSON for the latest successfully projected branch list. */
    lastProjectedBranchesJson: string | null;
    /**
     * Set once host departure has ended the session for this joiner, so a
     * later reconnect knows it must undo that state rather than guess from
     * the store's error text.
     */
    sessionEndedByHostDeparture: boolean;
    synchronizeAssetOwner: (() => void) | null;
    assetOwnershipTask: Promise<void>;
} = {
    peerManager: null,
    automergeSync: null,
    assetTransfer: null,
    cleanupProjectionBridge: null,
    playheadBroadcastInterval: null,
    pendingInviteId: null,
    hasBranchStateBackup: false,
    unsubscribeBranchStore: null,
    unsubscribeAutomergeChanges: null,
    isProjectingBranches: false,
    lastProjectedBranchesJson: null,
    sessionEndedByHostDeparture: false,
    synchronizeAssetOwner: null,
    assetOwnershipTask: Promise.resolve(),
};

/** Shown to a joiner once the host has really gone — see the cleanup timer. */
const HOST_DEPARTED_MESSAGE =
    'The session host disconnected — this session has ended. Your local copy of the project is intact; leave the session to continue working on it.';

/**
 * App-lifetime presence observers — deliberately OUTSIDE `sessionState`.
 *
 * Subscribers (the presence overlay hook mounts with the timeline surface,
 * independently of any session, and subscribes exactly once) own their
 * subscription lifetime through the disposer returned by `onPresence`.
 * Session teardown owns session state only: clearing this set in
 * `cleanupSubsystems` silenced presence for every session after the first,
 * because the long-lived subscriber never re-registers.
 */
const presenceListeners = new Set<(data: PresenceDelta) => void>();

/** Cleanup timers for peers that disconnected without sending peer-leave. */
const peerCleanupTimers = new Map<PeerId, ReturnType<typeof setTimeout>>();

const PEER_CLEANUP_DELAY_MS = 15_000;

const PLAYHEAD_BROADCAST_HZ = 4;

/**
 * Bound and validate the sender-controlled display fields on incoming presence
 * so a hostile peer can't supply an unbounded name string or an arbitrary color
 * value (both rendered in the presence overlay; the color is interpolated into
 * a CSS gradient). Behaviour-preserving for well-formed presence. The same
 * shared bounds apply at every identity ingress — see CollaborationTypes.
 */
function sanitizePresence(data: PresenceDelta): PresenceDelta {
    const name = sanitizePeerName(data.name);
    const color = sanitizePeerColor(data.color);
    if (name === data.name && color === data.color) {
        return data;
    }
    return { ...data, name, color };
}

// -- Branch sync helpers --

/**
 * Start session-scoped branch metadata sync.
 *
 * For the host: seeds the `__branches__` Automerge doc with current branch list.
 * For joiners: the doc is created on first receipt of a sync message from the host.
 *
 * During the session:
 *  - Local branch mutations (fork/delete/etc.) are mirrored into the Automerge doc
 *    so peers receive them via the normal sync protocol.
 *  - Incoming `__branches__` doc changes from peers are projected back into branchStore
 *    while a durable pre-session snapshot protects local branch metadata.
 *
 * Only `branches` is synced; `activeBranchId` is per-peer and never shared.
 */
function startBranchSync(isHost: boolean): void {
    preserveBranchStateForSession();
    sessionState.hasBranchStateBackup = true;

    if (isHost) {
        // Seed the metadata doc. Remove any stale doc from a previous session first.
        removeCrdtDoc(DOC_BRANCHES);
        createCrdtDoc(DOC_BRANCHES);
        const currentBranches = branchStore.value?.branches ?? [];
        mutateCrdtDoc({
            id: DOC_BRANCHES,
            changeFn: (doc: Record<string, unknown>) => {
                doc.branches = currentBranches;
            },
        });
    }
    // For joiners, the doc is created on demand in AutomergeSync.receiveSync.

    // Mirror local branch mutations into the Automerge doc.
    sessionState.unsubscribeBranchStore = branchStore.subscribe((state) => {
        if (sessionState.isProjectingBranches || !state) {
            return;
        }
        if (!hasCrdtDoc(DOC_BRANCHES)) {
            return;
        }
        const branches = structuredClone(state.branches);
        function writeBranchMetadata(): void {
            if (!hasCrdtDoc(DOC_BRANCHES)) {
                return;
            }
            mutateCrdtDoc({
                id: DOC_BRANCHES,
                changeFn: (doc: Record<string, unknown>) => {
                    doc.branches = branches;
                },
            });
        }
        const transition = waitForCrdtDocumentTransition(DOC_BRANCHES);
        if (!transition) {
            writeBranchMetadata();
            return;
        }
        void transition.then((outcome) => {
            if (outcome === 'committed') {
                writeBranchMetadata();
            }
            return undefined;
        });
    });

    // Project incoming __branches__ doc changes back into branchStore.
    sessionState.unsubscribeAutomergeChanges = subscribeToCrdtChanges((docId) => {
        // §138.1 — Skip the projection entirely when the hint tells us a
        // different doc changed. Only undefined (bulk) or DOC_BRANCHES
        // can affect the branch projection.
        if (docId !== undefined && docId !== DOC_BRANCHES) {
            return;
        }
        const doc = getCrdtDoc<{ branches: unknown }>(DOC_BRANCHES);
        if (!Array.isArray(doc?.branches)) {
            return;
        }
        const current = branchStore.value;
        const activeBranchId = current?.activeBranchId ?? MAIN_BRANCH_ID;
        const incomingJson = JSON.stringify(doc.branches);
        if (incomingJson === sessionState.lastProjectedBranchesJson) {
            return;
        }
        sessionState.isProjectingBranches = true;
        try {
            replaceBranchState({ branches: doc.branches, activeBranchId });
            sessionState.lastProjectedBranchesJson = incomingJson;
        } finally {
            sessionState.isProjectingBranches = false;
        }
    });
}

/**
 * Stop branch sync and restore the pre-session branchStore state.
 * Removes the `__branches__` Automerge doc so it isn't included in future saves.
 */
function stopBranchSync(): ReturnType<typeof restoreBranchStateAfterSession> | null {
    if (sessionState.unsubscribeBranchStore) {
        sessionState.unsubscribeBranchStore();
        sessionState.unsubscribeBranchStore = null;
    }
    if (sessionState.unsubscribeAutomergeChanges) {
        sessionState.unsubscribeAutomergeChanges();
        sessionState.unsubscribeAutomergeChanges = null;
    }

    removeCrdtDoc(DOC_BRANCHES);

    let restoreOutcome: ReturnType<typeof restoreBranchStateAfterSession> | null = null;
    if (sessionState.hasBranchStateBackup) {
        sessionState.isProjectingBranches = true;
        try {
            // Reports rather than throws on purpose. This `try` has no `catch`,
            // and everything left in teardown — stopping the sync, closing the
            // WebRTC peers — runs after it. A refused `localStorage` write used
            // to unwind from here and leave live peers connected to a session
            // the user had left. See #1557.
            restoreOutcome = restoreBranchStateAfterSession();
            sessionState.hasBranchStateBackup = false;
        } finally {
            sessionState.isProjectingBranches = false;
        }
    }
    sessionState.lastProjectedBranchesJson = null;

    // Persist without the __branches__ doc so IDB stays clean.
    persistCrdtProject().catch((error) => {
        logger.warn('[Collaboration] Failed to persist after branch sync cleanup:', error);
        setCollaborationError('Failed to save project locally after leaving the session.');
    });

    // Handed back rather than reported here. Reporting is the last thing
    // teardown does, after the peers are closed — see `cleanupSubsystems`.
    return restoreOutcome;
}

/**
 * Tell the user what leaving the session cost them, if anything.
 *
 * `notifyUser`, not `setCollaborationError`: every caller of
 * `cleanupSubsystems` — `leaveSession`, `createSession`, `joinSession` —
 * replaces the whole collaboration store immediately afterwards with
 * `error: null`, so anything written to that field during teardown is erased
 * synchronously before it can be rendered. That field is for errors raised
 * while a session is live; this one outlives the session by definition.
 *
 * The two failures are not the same failure and must not share a message: one
 * loses the branch list on reload, the other keeps it now and reverts to it
 * later. Both name the cause and an action. See #1557.
 */
function reportBranchRestoreOutcome(outcome: ReturnType<typeof restoreBranchStateAfterSession> | null): void {
    if (outcome === 'state-not-persisted') {
        notifyUser(
            'Left the session, but your branch list could not be saved — it will revert when you reopen the project. Free up storage space and try again.',
            'error'
        );
        return;
    }

    if (outcome === 'backup-not-cleared') {
        notifyUser(
            'Left the session, but a leftover session backup could not be cleared — your branch list may revert when you reopen the project. Free up storage space and try again.',
            'error'
        );
    }
}

/** Surface an error to the user via the collaboration store. */
function setCollaborationError(message: string): void {
    const state = collaborationStore.value;
    if (state) {
        collaborationStore.set({ ...state, error: message });
    }
}

/**
 * Record or retire a peer whose sync channel this node has closed.
 *
 * Deliberately not the `error` field. That slot holds one string, every
 * writer overwrites it without severity, and `clearCollaborationFailure`
 * nulls it from routine paths — a delivered audio asset, a new joiner being
 * admitted. A closed sync channel is the one condition here that never
 * resolves itself, and it stays true while the peer sits in the list looking
 * connected, so it lives in its own field that routine traffic cannot erase.
 */
function setPeerSyncQuarantined(peerId: PeerId, isQuarantined: boolean): void {
    collaborationStore.update((state) => {
        if (!state) {
            return state;
        }
        const alreadyListed = state.quarantinedPeerIds.includes(peerId);
        if (alreadyListed === isQuarantined) {
            return state;
        }
        return {
            ...state,
            quarantinedPeerIds: isQuarantined
                ? [...state.quarantinedPeerIds, peerId]
                : state.quarantinedPeerIds.filter((param) => param !== peerId),
        };
    });
}

/**
 * Build the hooks AutomergeSync uses to (1) keep branch metadata
 * host-authoritative and (2) surface persistence failures.
 *
 * There is deliberately no per-peer permission check here. An invite string
 * grants unconditional write access to the project: any peer that completes
 * the WebRTC handshake may mutate the root document and any branch content
 * document, with no role, capability or approval step in between. See
 * `generateInvite` and ADR 0016 (ruling 4) — a role scaffold with `viewer`
 * and `transport-controller` tiers used to sit at this call site, was never
 * reachable (`editor` was the only state ever granted), and was deleted
 * rather than left implying an enforcement that did not exist. Restricting
 * what a peer may do requires building and enforcing a real permission
 * model, not re-reading a role off the sync path.
 */
function buildAutomergeSyncHooks(): AutomergeSyncHooks {
    return {
        canApplySync: (peerId: PeerId, docId: string) => {
            // The host is the session authority: its syncs always apply.
            const senderIsHost =
                collaborationStore.value?.peers.some((param) => param.id === peerId && param.isHost) ?? false;
            if (senderIsHost) {
                return true;
            }
            // §fix-7 — Branch metadata is host-authoritative. A non-host sender
            // may never rewrite every joiner's branch list. This is a
            // structural single-writer rule for one document, not a
            // per-peer permission: every other document stays open to write.
            if (docId === DOC_BRANCHES) {
                return false;
            }
            return true;
        },
        onPersistError: () => {
            setCollaborationError('Failed to save received changes locally.');
        },
        onSyncApplied: ({ peerId, docId }) => {
            const senderIsHost =
                collaborationStore.value?.peers.some((peer) => peer.id === peerId && peer.isHost) ?? false;
            if (senderIsHost && docId === DOC_PREFIX_ROOT) {
                sessionState.synchronizeAssetOwner?.();
            }
        },
        onSendError: () => {
            // The peer is still connected but has not received these changes.
            // Saying so is the whole point: the alternative is a session that
            // looks healthy while the other side silently falls behind.
            setCollaborationError('Could not send project changes to a peer — they may be out of date.');
        },
        onSyncQuarantine: ({ peerId }) => {
            setPeerSyncQuarantined(peerId, true);
        },
        onSyncQuarantineLifted: ({ peerId }) => {
            setPeerSyncQuarantined(peerId, false);
        },
    };
}

function generatePeerId(): PeerId {
    return crypto.randomUUID();
}
function generateSessionId(): string {
    return crypto.randomUUID().slice(0, 8);
}

/**
 * Pick a distinct color not already in use. Prefers the curated palette;
 * once all palette entries are taken, falls back to golden-angle HSL slots
 * (peerColorForIndex) so a 9th+ peer gets a unique color instead of
 * colliding onto the host's blue.
 */
function pickPeerColor(excludeColors: string[]): string {
    const used = new Set(excludeColors);
    const fromPalette = PEER_COLORS.find((context) => !used.has(context));
    if (fromPalette) {
        return fromPalette;
    }
    // All palette colors are taken — advance through HSL overflow slots until
    // we find one not already assigned.
    for (let index = PEER_COLORS.length; ; index++) {
        const candidate = peerColorForIndex(index);
        if (!used.has(candidate)) {
            return candidate;
        }
    }
}

function getLocalPeerInfo(): CollaborationPeer {
    const state = collaborationStore.value!;
    return {
        id: state.localPeerId!,
        name: state.localName,
        color: state.localColor,
        isHost: state.isHost,
        isConnected: true,
        lastSeen: Date.now(),
        latencyMs: null,
    };
}

type InitializeSessionRuntimeOptions = { rebindToSynchronizedOwner?: boolean };

function initializeSessionRuntime(
    assetOwnerId: string,
    options: InitializeSessionRuntimeOptions = {}
): PeerConnectionManager {
    const peerManager = new PeerConnectionManager({
        onMessage: handlePeerMessage,
        onConnected: handlePeerConnected,
        onDisconnected: handlePeerDisconnected,
        onSendError: ({ error }) => {
            logger.warn('[Collaboration] Failed to broadcast to a peer:', error);
            setCollaborationError('Could not send project changes to a peer — they may be out of date.');
        },
    });
    sessionState.peerManager = peerManager;

    sessionState.automergeSync = new AutomergeSync(peerManager, buildAutomergeSyncHooks());
    sessionState.automergeSync.start();
    sessionState.cleanupProjectionBridge = setupProjectionBridge();

    sessionState.assetTransfer = new AssetTransfer(
        peerManager,
        {
            onAssetAvailable: (hash) => {
                void resolveAssetForClips(hash);
            },
            onProgress: (_hash, _received, _total) => {
                // Could update a UI progress indicator.
            },
            // An abandoned asset transfer is not a session failure — peers stay
            // connected and the hash becomes requestable again — but it does mean
            // clips referencing it stay silent, which the user otherwise has no way
            // to see. Surface it on the panel's error row.
            // The message names the retry condition rather than promising a retry:
            // the only thing that re-asks for an asset is the scheduler tick, so a
            // request is re-issued when playback next runs over a clip that needs
            // it — and only until AssetTransfer's attempt bound is spent.
            onTransferFailed: (hash, reason) => {
                logger.warn(`[Collaboration] Asset transfer failed for ${hash}: ${reason}`);
                setCollaborationError(
                    `Could not receive shared audio from a peer — ${reason}. Playing over the affected clips asks again.`
                );
            },
        },
        assetOwnerId
    );

    const assetTransfer = sessionState.assetTransfer;
    let ownerSynchronized = options.rebindToSynchronizedOwner !== true;
    let ownerSynchronizationQueued = false;
    const queueAssetOwnershipTask = (task: () => Promise<void>): void => {
        sessionState.assetOwnershipTask = sessionState.assetOwnershipTask
            .then(async () => {
                if (sessionState.assetTransfer !== assetTransfer) {
                    return;
                }
                await task();
            })
            .catch((error: unknown) => {
                logger.error(new Error('Collaboration durable asset ownership update failed', { cause: error }));
                setCollaborationError('Could not update ownership of shared audio. The operation can be retried.');
            });
    };
    if (options.rebindToSynchronizedOwner) {
        sessionState.synchronizeAssetOwner = () => {
            if (ownerSynchronized || ownerSynchronizationQueued) {
                return;
            }
            ownerSynchronizationQueued = true;
            queueAssetOwnershipTask(async () => {
                try {
                    const nextOwnerId = collaborationAssetOwnership.getOwnerId();
                    const result = await assetTransfer.rebindOwner(nextOwnerId);
                    if (result.status === 'failed') {
                        throw new Error(`Durable asset owner rebind failed: ${result.reason}`);
                    }
                    ownerSynchronized = true;
                    sessionState.synchronizeAssetOwner = null;
                } finally {
                    ownerSynchronizationQueued = false;
                }
            });
        };
    }

    return peerManager;
}

/** Tear down all subsystems without changing store state. */
function cleanupSubsystems(): void {
    sessionState.synchronizeAssetOwner = null;
    sessionState.pendingInviteId = null;
    sessionState.sessionEndedByHostDeparture = false;
    stopPlayheadBroadcast();
    const branchRestoreOutcome = stopBranchSync();
    for (const timer of peerCleanupTimers.values()) {
        clearTimeout(timer);
    }
    peerCleanupTimers.clear();
    if (sessionState.automergeSync) {
        sessionState.automergeSync.stop();
        sessionState.automergeSync = null;
    }
    if (sessionState.cleanupProjectionBridge) {
        sessionState.cleanupProjectionBridge();
        sessionState.cleanupProjectionBridge = null;
    }
    // Dispose before dropping the reference: in-flight transfers hold partial
    // chunk buffers and armed stall timers that would otherwise fire against a
    // torn-down session.
    sessionState.assetTransfer?.dispose();
    sessionState.assetTransfer = null;
    if (sessionState.peerManager) {
        sessionState.peerManager.closeAll();
        sessionState.peerManager = null;
    }
    // `presenceListeners` is deliberately NOT cleared here: it holds
    // app-lifetime observers owned by their subscribers, not session state.

    // Last, deliberately. Reporting must not be able to unwind teardown: a
    // throw from `notifyUser` used to skip `automergeSync.stop()`, the peer
    // cleanup timers, `cleanupProjectionBridge` and `closeAll()`, so the user
    // hit Leave, saw nothing, and stayed connected to live peers — the exact
    // failure the branch-restore report exists to prevent. Nothing that only
    // talks to the user runs before the session is actually torn down.
    reportBranchRestoreOutcome(branchRestoreOutcome);
}

// -- Asset resolution --

/**
 * When a peer sends us an audio asset, find all clips that reference its hash
 * and decode the blob into the AudioEngine buffer cache under their audioBufferId.
 * This lets the scheduler play the clip on the next playback start.
 */
async function resolveAssetForClips(hash: string): Promise<void> {
    const blob = sessionState.assetTransfer?.getAsset(hash);
    if (!blob) {
        return;
    }

    const tracks = trackStore.value?.tracks ?? [];
    let ctx: BaseAudioContext;
    try {
        ctx = getAudioContext();
    } catch {
        return;
    }

    for (const track of tracks) {
        for (const clip of track.clips) {
            if (clip.assetHash !== hash || !clip.audioBufferId) {
                continue;
            }
            if (getCachedAudioBuffer({ bufferId: clip.audioBufferId })) {
                continue;
            }
            try {
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                cacheAudioBuffer({ bufferId: clip.audioBufferId, buffer: audioBuffer });
            } catch {
                logger.warn('[Collaboration] Failed to decode asset for clip', clip.id);
            }
        }
    }

    // A delivered asset retires whatever transfer failure is on the panel. The
    // failure row is written by `onTransferFailed` and otherwise only cleared by
    // session-lifecycle use cases, so without this the message survives its own
    // successful retry and sits there until the user leaves the session.
    clearCollaborationFailure();
}

// -- Playhead broadcast --

function startPlayheadBroadcast(): void {
    sessionState.playheadBroadcastInterval = setInterval(() => {
        if (!sessionState.peerManager || sessionState.peerManager.getConnectedPeerIds().length === 0) {
            return;
        }
        const state = collaborationStore.value;
        if (!state?.localPeerId) {
            return;
        }
        const playheadBeat = transportStore.value?.playheadPosition ?? null;
        // §fix-9 — Playhead-only delta. Omitting the cursor/selection fields
        // (rather than nulling them) lets the receiver's merge preserve the
        // cursor set by the higher-rate cursor-broadcast path, eliminating the
        // 4 Hz presence flicker.
        sessionState.peerManager.broadcastPresence({
            type: 'presence',
            data: {
                peerId: state.localPeerId,
                name: state.localName,
                color: state.localColor,
                playheadBeat,
            },
        });
    }, 1000 / PLAYHEAD_BROADCAST_HZ);
}

function stopPlayheadBroadcast(): void {
    if (sessionState.playheadBroadcastInterval !== null) {
        clearInterval(sessionState.playheadBroadcastInterval);
        sessionState.playheadBroadcastInterval = null;
    }
}

// -- Internal handlers --

type HandlePeerMessageInput = { peerId: PeerId; message: PeerMessage };
function handlePeerMessage({ peerId, message }: HandlePeerMessageInput): void {
    if (message.type === 'crdt-sync') {
        // Route by docId to the appropriate subsystem
        if (message.docId === DOC_ID_ASSET) {
            void sessionState.assetTransfer?.handleMessage(peerId, message);
        } else {
            // A `__permissions__` doc used to be routed to a role manager here.
            // That scaffold is gone (ADR 0016 ruling 4); AutomergeSync drops the
            // docId as unknown, so a stale peer's role grant has no effect.
            sessionState.automergeSync?.handlePeerMessage({ peerId, message });
        }
    } else if (message.type === 'presence') {
        // Only surface presence from a peer the store already knows, and bound
        // the sender-supplied display fields so a hostile peer can't blow up
        // overlay rendering with megabyte names/colors.
        const known = collaborationStore.value?.peers.some((param) => param.id === message.data.peerId);
        if (message.data.peerId === peerId && known) {
            const sanitized = sanitizePresence(message.data);
            for (const listener of presenceListeners) {
                listener(sanitized);
            }
        }
        updatePeerLastSeen(peerId);
    } else if (message.type === 'peer-info') {
        addOrUpdatePeer({ senderPeerId: peerId, peer: message.peer });
    } else if (message.type === 'peer-leave') {
        // Only honor a self-leave: a peer may remove itself, never a third
        // party. Without this a hostile joiner could eject any other peer by
        // id (closing the underlying connection).
        if (message.peerId === peerId) {
            removePeer(message.peerId);
        }
    }
}

function handlePeerConnected(peerId: PeerId): void {
    // Cancel any pending cleanup from a prior disconnect.
    const existing = peerCleanupTimers.get(peerId);
    if (existing !== undefined) {
        clearTimeout(existing);
        peerCleanupTimers.delete(peerId);
    }

    sessionState.automergeSync?.addPeer(peerId);

    void sessionState.peerManager
        ?.sendCrdtSync({
            peerId,
            message: { type: 'peer-info', peer: getLocalPeerInfo() },
        })
        .catch((error: unknown) => {
            logger.warn('[Collaboration] Failed to send peer-info to', peerId, error);
        });

    // §fix-16 — As host, tell the joiner the color we assigned it (chosen in
    // acceptAnswer) so it can reconcile its locally-picked color. The joiner
    // recognises a peer-info whose id matches its own localPeerId as its
    // host-assigned record.
    const hostState = collaborationStore.value;
    if (hostState?.isHost) {
        const assigned = hostState.peers.find((param) => param.id === peerId);
        if (assigned) {
            void sessionState.peerManager
                ?.sendCrdtSync({
                    peerId,
                    message: { type: 'peer-info', peer: { ...assigned, isConnected: true, lastSeen: Date.now() } },
                })
                .catch((error: unknown) => {
                    logger.warn('[Collaboration] Failed to send assigned peer-info to', peerId, error);
                });
        }
    }

    // No role or capability is assigned on connect. Completing the handshake
    // *is* the grant: this peer now has unconditional write access to the
    // project. The host previously auto-granted an `editor` role here, which
    // made the permission machinery look meaningful while never denying
    // anyone — deleted per ADR 0016 ruling 4.
    updatePeerConnectionState(peerId, true);

    // A reconnect must undo the session-ended state, not just paint over it:
    // the error tells the user the session is finished, and the joiner's
    // playhead is missing from every other peer until its broadcast is
    // restarted. `stopPlayheadBroadcast` first so a live interval can never be
    // orphaned by overwriting its handle.
    const recovered = sessionState.sessionEndedByHostDeparture;
    if (recovered) {
        sessionState.sessionEndedByHostDeparture = false;
        stopPlayheadBroadcast();
        startPlayheadBroadcast();
    }

    const state = collaborationStore.value;
    if (state) {
        collaborationStore.set({
            ...state,
            connectionStatus: 'connected',
            error: recovered && state.error === HOST_DEPARTED_MESSAGE ? null : state.error,
            quarantinedPeerIds: [],
        });
    }
}

/**
 * Declare the session over for a joiner whose host has gone for good.
 *
 * Host departure on a joiner ends the session as a matter of fact, not policy:
 * the topology is host-relayed — every joiner's only connection is to the
 * host, so with the host gone no data, presence, or sync can flow and manual
 * SDP signaling offers no rejoin path. Host-relayed collaboration tools
 * surface this as an explicit session-ended state rather than continuing
 * masterless (that is Ableton-Link-style topology, which this is not).
 * Deliberately NOT an auto-leave: the local CRDT copy of the project stays
 * intact (non-destructive) and the user gets an explicit signal instead of a
 * session that silently looks alive.
 */
function endSessionAfterHostDeparture(): void {
    sessionState.sessionEndedByHostDeparture = true;
    stopPlayheadBroadcast();
    const state = collaborationStore.value;
    if (state) {
        collaborationStore.set({ ...state, connectionStatus: 'disconnected', error: HOST_DEPARTED_MESSAGE });
    }
}

function handlePeerDisconnected(peerId: PeerId): void {
    sessionState.automergeSync?.removePeer(peerId);
    updatePeerConnectionState(peerId, false);

    // Schedule removal in case the peer never sends peer-leave (tab crash, etc.).
    //
    // Everything that treats the peer as permanently gone belongs in this
    // callback, not in the immediate path. `onDisconnected` also fires on
    // `connectionState === 'disconnected'`, which W3C WebRTC defines as
    // transient — ICE recovers from it without the data channel ever closing.
    // This timer is what encodes "the peer really went away": it is cancelled
    // in handlePeerConnected the moment the peer comes back.
    const timer = setTimeout(() => {
        peerCleanupTimers.delete(peerId);
        const current = collaborationStore.value;
        const hostDeparted =
            current !== null && !current.isHost && current.peers.some((param) => param.id === peerId && param.isHost);
        removePeer(peerId);
        if (hostDeparted) {
            endSessionAfterHostDeparture();
        }
    }, PEER_CLEANUP_DELAY_MS);
    peerCleanupTimers.set(peerId, timer);

    const state = collaborationStore.value;
    if (!state) {
        return;
    }

    const anyConnected = state.peers.some((param) => param.isConnected && param.id !== peerId);
    if (!anyConnected && state.peers.length > 0) {
        collaborationStore.set({ ...state, connectionStatus: 'disconnected' });
    }
}

type AddOrUpdatePeerInput = { senderPeerId: PeerId; peer: CollaborationPeer };

function addOrUpdatePeer({ senderPeerId, peer }: AddOrUpdatePeerInput): void {
    const current = collaborationStore.value;
    if (!current) {
        return;
    }

    // The id is sender-controlled and is stored, keyed on, and rendered
    // downstream. Refuse an over-length one outright rather than truncating
    // it: an id is an identity key, and a cut id would collide with another
    // peer's record. See isAcceptablePeerId.
    if (!isAcceptablePeerId(peer.id)) {
        logger.warn('[Collaboration] Ignoring a peer-info with an over-length peer id from', senderPeerId);
        return;
    }

    // §fix-16 — A peer-info describing *us* is the host's color assignment for
    // this node. Adopt the assigned color so we render the same color others
    // see, instead of the one we picked locally on join. Don't add ourselves to
    // the peer list.
    if (peer.id === current.localPeerId) {
        const senderIsHost = current.peers.some((param) => param.id === senderPeerId && param.isHost);
        if (!current.isHost && senderIsHost && peer.color) {
            const assignedColor = sanitizePeerColor(peer.color);
            if (assignedColor !== current.localColor) {
                collaborationStore.set({ ...current, localColor: assignedColor });
            }
        }
        return;
    }

    // §fix-2 — A peer may not promote itself (or anyone) to host via peer-info.
    // Host authority is established locally at join/accept time; an incoming
    // peer-info can confirm an existing host flag but never grant a new one.
    // §fix-13 — Functional update so concurrent peer-list writes compose
    // rather than clobber.
    collaborationStore.update((state) => {
        if (!state) {
            return state;
        }
        const existingIndex = state.peers.findIndex((param) => param.id === peer.id);
        const trustedIsHost = existingIndex >= 0 ? state.peers[existingIndex]!.isHost : false;
        // Bound the sender-controlled display fields with the same limits
        // presence uses — peer-info is just another identity ingress, and this
        // record renders in the peer list and presence overlay.
        const merged: CollaborationPeer = {
            ...peer,
            name: sanitizePeerName(peer.name),
            color: sanitizePeerColor(peer.color),
            isHost: trustedIsHost,
            isConnected: true,
            lastSeen: Date.now(),
        };
        if (existingIndex >= 0) {
            const peers = state.peers.map((param) => (param.id === peer.id ? merged : param));
            return { ...state, peers };
        }
        return { ...state, peers: [...state.peers, merged] };
    });
}

/**
 * Remove a peer that is durably gone — it left, or its cleanup timer elapsed.
 *
 * `automergeSync.forgetPeer`, not `removePeer`: this is the only place that
 * decides a peer really went away, so it is the only place allowed to reopen
 * a sync channel that was closed against it. The immediate disconnect path
 * also fires on the transient ICE `disconnected` state.
 */
function removePeer(peerId: PeerId): void {
    collaborationStore.update((state) => {
        if (!state) {
            return state;
        }
        return { ...state, peers: state.peers.filter((param) => param.id !== peerId) };
    });
    sessionState.automergeSync?.forgetPeer(peerId);
    sessionState.peerManager?.removePeer(peerId);
}

function updatePeerLastSeen(peerId: PeerId): void {
    collaborationStore.update((state) => {
        if (!state) {
            return state;
        }
        return {
            ...state,
            peers: state.peers.map((param) => (param.id === peerId ? { ...param, lastSeen: Date.now() } : param)),
        };
    });
}

function updatePeerConnectionState(peerId: PeerId, isConnected: boolean): void {
    collaborationStore.update((state) => {
        if (!state) {
            return state;
        }
        return {
            ...state,
            peers: state.peers.map((param) =>
                param.id === peerId ? { ...param, isConnected, lastSeen: Date.now() } : param
            ),
        };
    });
}

// -- Invite compression --
// Invites embed a full ICE-complete SDP, which can be several KB.
// Compressing with deflate-raw before base64 keeps QR codes scannable
// and makes copy-paste strings manageable.
// The 'z:' prefix lets joiners detect and decompress transparently,
// so old uncompressed invites continue to work during any transition.

async function readAllChunks(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
    }
    const total = chunks.reduce((node, context) => node + context.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

async function compressInvite(json: string): Promise<string> {
    const bytes = new TextEncoder().encode(json);
    const stream = new CompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    void writer.write(bytes);
    void writer.close();
    const result = await readAllChunks(stream.readable);
    return `z:${bytesToBase64(result)}`;
}

async function decompressInvite(raw: string): Promise<string> {
    if (!raw.startsWith('z:')) {
        // Legacy uncompressed invite. The encoder this replaced was
        // `btoa(JSON.stringify(invite))`, and `btoa` takes a binary string —
        // one code unit per byte — so a legacy invite is base64 of Latin-1,
        // not of UTF-8. `atob` is its exact inverse. UTF-8-decoding these
        // bytes instead would mangle every Latin-1-range name (e.g. "José"),
        // and no other non-ASCII class exists here: `btoa` threw at encode
        // time on anything above U+00FF, so such an invite was never minted.
        return atob(raw);
    }
    const binary = atob(raw.slice(2));
    const bytes = Uint8Array.from(binary, (context) => context.charCodeAt(0));
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    void writer.write(bytes);
    void writer.close();
    const result = await readAllChunks(stream.readable);
    return new TextDecoder().decode(result);
}

/** Shared state and runtime primitives used by the focused use cases. */
export const sessionRuntimePrimitives = {
    state: sessionState,
    presenceListeners,
    initialize: initializeSessionRuntime,
    cleanup: cleanupSubsystems,
    startBranchSync,
    startPlayheadBroadcast,
    generatePeerId,
    generateSessionId,
    pickPeerColor,
    compressInvite,
    decompressInvite,
    flushAssetOwnership: () => sessionState.assetOwnershipTask,
};
