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
    replaceBranchState,
} from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { bytesToBase64 } from '#/utils/base64';

import { createCollaborationError } from '../../errors/CollaborationError';
import {
    type PeerId,
    type PeerMessage,
    type SignalingMessage,
    PEER_COLORS,
    peerColorForIndex,
    type PresenceDelta,
} from '../../models/CollaborationTypes';
import { DOC_ID_ASSET } from '../../models/SyncChannelConstants';
import { PeerConnectionManager } from '../../repositories/peerConnection';
import { collaborationStore } from '../../stores/collaborationStore';
import { AssetTransfer } from '../assetTransfer';
import { AutomergeSync, type AutomergeSyncHooks } from '../automergeSync';
import { type CollaborationPeer, type PresenceData } from '../collaborationQueries';
import { PermissionManager } from '../permissions';

type LocalBranchRecord = {
    branchId: string;
    name: string;
    rootDocId: string;
    sourceBranchId: string | null;
    createdAt: number;
    createdFromHeads: string[];
    note: string;
};

type LocalBranchState = {
    branches: LocalBranchRecord[];
    activeBranchId: string;
};

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
    permissionManager: PermissionManager | null;
    cleanupProjectionBridge: (() => void) | null;
    presenceListeners: Set<(data: PresenceDelta) => void>;
    playheadBroadcastInterval: ReturnType<typeof setInterval> | null;
    /** Host-assigned peer slot ID for the in-flight invite, if any. */
    pendingInviteId: PeerId | null;
    /** Snapshot of branchStore taken at session start; restored on session end. */
    branchStoreSnapshot: LocalBranchState | null;
    /** Unsubscribe from branchStore changes (local mutations → Automerge doc). */
    unsubscribeBranchStore: (() => void) | null;
    /** Unsubscribe from automergeRepository changes (__branches__ doc → branchStore). */
    unsubscribeAutomergeChanges: (() => void) | null;
    /**
     * Guard flag to prevent infinite update loop: projecting __branches__ →
     * branchStore triggers branchStore.subscribe, which must not write back.
     */
    isProjectingBranches: boolean;
    /**
     * §114.3 — Cached canonical JSON of the last branches array projected
     * into branchStore. Lets the projection short-circuit when the
     * incoming Automerge doc hasn't actually changed, avoiding a full
     * re-stringify of the current branchStore state on every CRDT tick.
     */
    lastProjectedBranchesJson: string | null;
} = {
    peerManager: null,
    automergeSync: null,
    assetTransfer: null,
    permissionManager: null,
    cleanupProjectionBridge: null,
    presenceListeners: new Set(),
    playheadBroadcastInterval: null,
    pendingInviteId: null,
    branchStoreSnapshot: null,
    unsubscribeBranchStore: null,
    unsubscribeAutomergeChanges: null,
    isProjectingBranches: false,
    lastProjectedBranchesJson: null,
};

/** Cleanup timers for peers that disconnected without sending peer-leave. */
const peerCleanupTimers = new Map<PeerId, ReturnType<typeof setTimeout>>();

const PEER_CLEANUP_DELAY_MS = 15_000;

const PLAYHEAD_BROADCAST_HZ = 4;

/** Max accepted length for sender-supplied presence display fields. */
const MAX_PRESENCE_NAME_LEN = 64;
const MAX_PRESENCE_COLOR_LEN = 32;

/** Fallback applied when a peer's presence color is not a well-formed CSS color. */
const FALLBACK_PRESENCE_COLOR = '#888888';

/**
 * Accept only the CSS color formats this app actually mints for peers — hex
 * (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`) and the functional `hsl()/hsla()/
 * rgb()/rgba()` forms (see PEER_COLORS and peerColorForIndex). Anything else is
 * rejected so a sender-supplied string can't break out of the CSS gradient
 * value it is interpolated into at PresenceMarker.tsx (`repeating-linear-gradient
 * (..., ${color}, ...)`).
 */
const SAFE_CSS_COLOR_RE =
    /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgb|rgba|hsl|hsla)\([0-9.,%/\s]+\))$/;

function isSafeCssColor(color: string): boolean {
    return SAFE_CSS_COLOR_RE.test(color);
}

/**
 * Bound and validate the sender-controlled display fields on incoming presence
 * so a hostile peer can't supply an unbounded name string or an arbitrary color
 * value (both rendered in the presence overlay; the color is interpolated into
 * a CSS gradient). Behaviour-preserving for well-formed presence.
 */
function sanitizePresence(data: PresenceDelta): PresenceDelta {
    const name = data.name.length <= MAX_PRESENCE_NAME_LEN ? data.name : data.name.slice(0, MAX_PRESENCE_NAME_LEN);
    const boundedColor =
        data.color.length <= MAX_PRESENCE_COLOR_LEN ? data.color : data.color.slice(0, MAX_PRESENCE_COLOR_LEN);
    const color = isSafeCssColor(boundedColor) ? boundedColor : FALLBACK_PRESENCE_COLOR;
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
 *    (in-memory only — we restore the pre-session snapshot on leave).
 *
 * Only `branches` is synced; `activeBranchId` is per-peer and never shared.
 */
function startBranchSync(isHost: boolean): void {
    // Snapshot current state so we can restore it on session end. Deep-clone
    // the branch records (not just the array) so live edits during the
    // session can't mutate the snapshot we restore from on leave.
    sessionState.branchStoreSnapshot = branchStore.value ? structuredClone(branchStore.value) : null;

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
        mutateCrdtDoc({
            id: DOC_BRANCHES,
            changeFn: (doc: Record<string, unknown>) => {
                doc.branches = state.branches;
            },
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
        const doc = getCrdtDoc<{ branches: LocalBranchState['branches'] }>(DOC_BRANCHES);
        if (!doc?.branches) {
            return;
        }
        const current = branchStore.value;
        const incomingBranches = Array.from(doc.branches);
        const activeBranchId = current?.activeBranchId ?? MAIN_BRANCH_ID;
        // §114.3 — Compare the incoming JSON against the canonical JSON we
        // cached on the last successful projection. If they match, skip the
        // diff entirely. This avoids re-stringifying `current?.branches` on
        // every CRDT tick that fires without an actual branches change.
        const incomingJson = JSON.stringify(incomingBranches);
        if (incomingJson === sessionState.lastProjectedBranchesJson) {
            return;
        }
        sessionState.isProjectingBranches = true;
        try {
            // Keep the peer's own activeBranchId — don't force them onto the host's branch.
            const validActiveBranchId = incomingBranches.some((branch) => branch.branchId === activeBranchId)
                ? activeBranchId
                : MAIN_BRANCH_ID;
            replaceBranchState({ branches: incomingBranches, activeBranchId: validActiveBranchId });
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
function stopBranchSync(): void {
    if (sessionState.unsubscribeBranchStore) {
        sessionState.unsubscribeBranchStore();
        sessionState.unsubscribeBranchStore = null;
    }
    if (sessionState.unsubscribeAutomergeChanges) {
        sessionState.unsubscribeAutomergeChanges();
        sessionState.unsubscribeAutomergeChanges = null;
    }

    removeCrdtDoc(DOC_BRANCHES);

    if (sessionState.branchStoreSnapshot) {
        sessionState.isProjectingBranches = true;
        try {
            replaceBranchState(sessionState.branchStoreSnapshot);
        } finally {
            sessionState.isProjectingBranches = false;
        }
        sessionState.branchStoreSnapshot = null;
    }
    sessionState.lastProjectedBranchesJson = null;

    // Persist without the __branches__ doc so IDB stays clean.
    persistCrdtProject().catch((error) => {
        logger.warn('[Collaboration] Failed to persist after branch sync cleanup:', error);
        setCollaborationError('Failed to save project locally after leaving the session.');
    });
}

/** Surface an error to the user via the collaboration store. */
function setCollaborationError(message: string): void {
    const state = collaborationStore.value;
    if (state) {
        collaborationStore.set({ ...state, error: message });
    }
}

/**
 * Build the hooks AutomergeSync uses to (1) enforce the edit boundary and
 * (2) surface persistence failures. Read lazily so the predicate sees the
 * permission manager once it's constructed.
 */
function buildAutomergeSyncHooks(): AutomergeSyncHooks {
    return {
        canApplySync: (peerId: PeerId, docId: string) => {
            // The host is the session authority: its syncs always apply. The
            // host's own edit capability is never broadcast as a role.grant
            // (it's implicit), so canEdit(host) is false on joiners — without
            // this short-circuit a joiner would wrongly drop the host's root
            // sync and break the fundamental project sync.
            const senderIsHost =
                collaborationStore.value?.peers.some((param) => param.id === peerId && param.isHost) ?? false;
            if (senderIsHost) {
                return true;
            }
            // §fix-7 — Branch metadata is host-authoritative. A non-host sender
            // may never rewrite every joiner's branch list.
            if (docId === DOC_BRANCHES) {
                return false;
            }
            const manager = sessionState.permissionManager;
            // No permission manager yet → fail open (session not fully wired).
            if (!manager) {
                return true;
            }
            // §fix-1 — A non-host peer without edit capability (e.g. a viewer)
            // must not be able to mutate the project via the sync channel.
            return manager.canEdit(peerId);
        },
        onPersistError: () => {
            setCollaborationError('Failed to save received changes locally.');
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

/**
 * Create a new collaboration session as host.
 * Returns the session ID.
 */
export function createSession(name: string): string {
    // Clean up any existing session first
    cleanupSubsystems();

    const peerId = generatePeerId();
    const sessionId = generateSessionId();
    const color = pickPeerColor([]);

    sessionState.peerManager = new PeerConnectionManager({
        onMessage: handlePeerMessage,
        onConnected: handlePeerConnected,
        onDisconnected: handlePeerDisconnected,
    });

    sessionState.automergeSync = new AutomergeSync(sessionState.peerManager, buildAutomergeSyncHooks());
    sessionState.automergeSync.start();
    sessionState.cleanupProjectionBridge = setupProjectionBridge();

    sessionState.assetTransfer = new AssetTransfer(sessionState.peerManager, {
        onAssetAvailable: (hash) => {
            void resolveAssetForClips(hash);
        },
        onProgress: (_hash, _received, _total) => {
            // Could update a UI progress indicator.
        },
    });

    sessionState.permissionManager = new PermissionManager(sessionState.peerManager);
    startPlayheadBroadcast();
    startBranchSync(true);

    collaborationStore.set({
        isEnabled: true,
        sessionId,
        localPeerId: peerId,
        localName: name,
        localColor: color,
        isHost: true,
        peers: [],
        connectionStatus: 'disconnected',
        error: null,
    });

    return sessionId;
}

/**
 * Generate an invite string containing the SDP offer for a new peer.
 * The host calls this, copies the result, and the joiner pastes it into `joinSession`.
 */
export async function generateInvite(): Promise<string> {
    if (!sessionState.peerManager) {
        throw createCollaborationError('No active session');
    }

    // Clean up any previously generated invite that was never answered.
    if (sessionState.pendingInviteId) {
        sessionState.peerManager.removePeer(sessionState.pendingInviteId);
        sessionState.pendingInviteId = null;
    }

    const joinerPeerId = generatePeerId();
    sessionState.pendingInviteId = joinerPeerId;
    const peer = sessionState.peerManager.createPeer(joinerPeerId);
    const sdp = await peer.createOffer();

    const state = collaborationStore.value!;
    const invite: SignalingMessage = {
        type: 'offer',
        peerId: state.localPeerId!,
        name: state.localName,
        sessionId: state.sessionId!,
        sdp,
        pendingPeerId: joinerPeerId,
    };

    return await compressInvite(JSON.stringify(invite));
}

/**
 * Join a session by pasting an invite string.
 * Returns an answer string to send back to the host.
 */
export async function joinSession(inviteString: string, name: string): Promise<string> {
    cleanupSubsystems();

    if (!inviteString.trim()) {
        throw createCollaborationError('Invite string is empty');
    }

    let invite: SignalingMessage;
    try {
        const json = await decompressInvite(inviteString.trim());
        invite = JSON.parse(json) as SignalingMessage;
    } catch {
        throw createCollaborationError('Invalid invite — must be a valid invite string');
    }

    if (invite.type !== 'offer') {
        throw createCollaborationError('Invalid invite: expected offer');
    }

    const peerId = generatePeerId();
    // Pick a color that doesn't clash with the host's (always the first color).
    const color = pickPeerColor([PEER_COLORS[0]]);

    sessionState.peerManager = new PeerConnectionManager({
        onMessage: handlePeerMessage,
        onConnected: handlePeerConnected,
        onDisconnected: handlePeerDisconnected,
    });

    sessionState.automergeSync = new AutomergeSync(sessionState.peerManager, buildAutomergeSyncHooks());
    sessionState.automergeSync.start();
    sessionState.cleanupProjectionBridge = setupProjectionBridge();

    sessionState.assetTransfer = new AssetTransfer(sessionState.peerManager, {
        onAssetAvailable: (hash) => {
            void resolveAssetForClips(hash);
        },
        onProgress: (_hash, _received, _total) => {},
    });

    sessionState.permissionManager = new PermissionManager(sessionState.peerManager);
    startPlayheadBroadcast();
    startBranchSync(false);

    const peer = sessionState.peerManager.createPeer(invite.peerId);
    const answerSdp = await peer.acceptOffer(invite.sdp);

    collaborationStore.set({
        isEnabled: true,
        sessionId: invite.sessionId,
        localPeerId: peerId,
        localName: name,
        localColor: color,
        isHost: false,
        peers: [
            {
                id: invite.peerId,
                name: invite.name,
                color: PEER_COLORS[0],
                isHost: true,
                isConnected: false,
                lastSeen: Date.now(),
                latencyMs: null,
            },
        ],
        connectionStatus: 'connecting',
        error: null,
    });

    const answer: SignalingMessage = {
        type: 'answer',
        peerId,
        name,
        sdp: answerSdp,
        pendingPeerId: invite.pendingPeerId,
    };

    return await compressInvite(JSON.stringify(answer));
}

/**
 * Accept an answer from a joiner (host side, completes the connection).
 */
export async function acceptAnswer(answerString: string): Promise<void> {
    const json = await decompressInvite(answerString);
    const answer = JSON.parse(json) as SignalingMessage;
    if (answer.type !== 'answer') {
        throw createCollaborationError('Invalid answer');
    }

    if (!sessionState.peerManager) {
        throw createCollaborationError('No active session');
    }

    const peer = sessionState.peerManager.getPeer(answer.pendingPeerId);
    if (!peer) {
        throw createCollaborationError('No pending peer connection matches this answer — the invite may have expired');
    }

    await peer.acceptAnswer(answer.sdp);
    sessionState.pendingInviteId = null;

    // Add the joiner to our peer list
    const state = collaborationStore.value;
    if (state) {
        const joinerInfo: CollaborationPeer = {
            id: answer.peerId,
            name: answer.name,
            color: pickPeerColor([state.localColor, ...state.peers.map((param) => param.color)]),
            isHost: false,
            isConnected: false,
            lastSeen: Date.now(),
            latencyMs: null,
        };
        collaborationStore.set({
            ...state,
            peers: [...state.peers, joinerInfo],
        });
    }
}

/** Tear down all subsystems without changing store state. */
function cleanupSubsystems(): void {
    sessionState.pendingInviteId = null;
    stopPlayheadBroadcast();
    stopBranchSync();
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
    if (sessionState.permissionManager) {
        sessionState.permissionManager.clear();
        sessionState.permissionManager = null;
    }
    sessionState.assetTransfer = null;
    if (sessionState.peerManager) {
        sessionState.peerManager.closeAll();
        sessionState.peerManager = null;
    }
    sessionState.presenceListeners.clear();
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

/**
 * Leave the current session.
 *
 * §fix-11 — Previously this broadcast `peer-leave` and then immediately called
 * `closeAll()`, which dropped the buffered message: the remote never saw the
 * leave and waited the full PEER_CLEANUP_DELAY_MS before reaping us. We now
 * send the leave through the buffered/back-pressure-aware send path and await
 * it per connected peer before tearing the channels down, so the message
 * actually flushes. Returns a Promise so callers may await the flush; existing
 * fire-and-forget callers are unaffected (cleanup still runs after the await).
 */
export async function leaveSession(): Promise<void> {
    const peerManager = sessionState.peerManager;
    if (peerManager) {
        const leaveMessage: PeerMessage = {
            type: 'peer-leave',
            peerId: collaborationStore.value?.localPeerId ?? '',
        };
        // Drain the send buffer to each connected peer before closing so the
        // leave isn't discarded mid-flight by closeAll().
        await Promise.all(
            peerManager.getConnectedPeerIds().map((peerId) =>
                peerManager.sendCrdtSyncBuffered({ peerId, message: leaveMessage }).catch(() => {
                    // A peer that errors/closes during flush is being torn down
                    // anyway; ignore so the remaining peers still get the leave.
                })
            )
        );
    }

    cleanupSubsystems();

    collaborationStore.set({
        isEnabled: false,
        sessionId: null,
        localPeerId: null,
        localName: '',
        localColor: '',
        isHost: false,
        peers: [],
        connectionStatus: 'disconnected',
        error: null,
    });
}

/**
 * Broadcast a local presence delta to all peers.
 *
 * §fix-9 — Callers send only the fields their path owns (e.g. the cursor path
 * omits playheadBeat). Omitted fields are preserved by the receiver's merge,
 * so the cursor broadcast and the playhead heartbeat no longer clobber each
 * other's state.
 */
export function broadcastPresence(data: Partial<Omit<PresenceData, 'peerId' | 'name' | 'color'>>): void {
    if (!sessionState.peerManager) {
        return;
    }

    const state = collaborationStore.value;
    if (!state?.localPeerId) {
        return;
    }

    sessionState.peerManager.broadcastPresence({
        type: 'presence',
        data: {
            ...data,
            peerId: state.localPeerId,
            name: state.localName,
            color: state.localColor,
        },
    });
}

/**
 * Subscribe to incoming presence data from peers.
 */
export function onPresence(listener: (data: PresenceDelta) => void): () => void {
    sessionState.presenceListeners.add(listener);
    return () => {
        sessionState.presenceListeners.delete(listener);
    };
}

/** Get the asset transfer instance (for requesting/providing assets). */
export function getAssetTransfer(): AssetTransfer | null {
    return sessionState.assetTransfer;
}

// -- Internal handlers --

type HandlePeerMessageInput = { peerId: PeerId; message: PeerMessage };
function handlePeerMessage({ peerId, message }: HandlePeerMessageInput): void {
    if (message.type === 'crdt-sync') {
        // Route by docId to the appropriate subsystem
        if (message.docId === DOC_ID_ASSET) {
            void sessionState.assetTransfer?.handleMessage(peerId, message);
        } else if (message.docId === '__permissions__') {
            sessionState.permissionManager?.handleMessage(peerId, message);
        } else {
            sessionState.automergeSync?.handlePeerMessage({ peerId, message });
        }
    } else if (message.type === 'presence') {
        // Only surface presence from a peer the store already knows, and bound
        // the sender-supplied display fields so a hostile peer can't blow up
        // overlay rendering with megabyte names/colors.
        const known = collaborationStore.value?.peers.some((param) => param.id === message.data.peerId);
        if (message.data.peerId === peerId && known) {
            const sanitized = sanitizePresence(message.data);
            for (const listener of sessionState.presenceListeners) {
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

    sessionState.peerManager?.sendCrdtSync({
        peerId,
        message: { type: 'peer-info', peer: getLocalPeerInfo() },
    });

    // §fix-16 — As host, tell the joiner the color we assigned it (chosen in
    // acceptAnswer) so it can reconcile its locally-picked color. The joiner
    // recognises a peer-info whose id matches its own localPeerId as its
    // host-assigned record.
    const hostState = collaborationStore.value;
    if (hostState?.isHost) {
        const assigned = hostState.peers.find((param) => param.id === peerId);
        if (assigned) {
            sessionState.peerManager?.sendCrdtSync({
                peerId,
                message: { type: 'peer-info', peer: { ...assigned, isConnected: true, lastSeen: Date.now() } },
            });
        }
    }

    // Host auto-grants editor role so joiners can edit immediately.
    sessionState.permissionManager?.grantRole(peerId, 'editor');

    updatePeerConnectionState(peerId, true);

    const state = collaborationStore.value;
    if (state) {
        collaborationStore.set({ ...state, connectionStatus: 'connected' });
    }
}

function handlePeerDisconnected(peerId: PeerId): void {
    sessionState.automergeSync?.removePeer(peerId);
    updatePeerConnectionState(peerId, false);

    // Schedule removal in case the peer never sends peer-leave (tab crash, etc.).
    const timer = setTimeout(() => {
        peerCleanupTimers.delete(peerId);
        removePeer(peerId);
    }, PEER_CLEANUP_DELAY_MS);
    peerCleanupTimers.set(peerId, timer);

    const state = collaborationStore.value;
    if (state) {
        const anyConnected = state.peers.some((param) => param.isConnected && param.id !== peerId);
        if (!anyConnected && state.peers.length > 0) {
            collaborationStore.set({ ...state, connectionStatus: 'disconnected' });
        }
    }
}

type AddOrUpdatePeerInput = { senderPeerId: PeerId; peer: CollaborationPeer };

function addOrUpdatePeer({ senderPeerId, peer }: AddOrUpdatePeerInput): void {
    const current = collaborationStore.value;
    if (!current) {
        return;
    }

    // §fix-16 — A peer-info describing *us* is the host's color assignment for
    // this node. Adopt the assigned color so we render the same color others
    // see, instead of the one we picked locally on join. Don't add ourselves to
    // the peer list.
    if (peer.id === current.localPeerId) {
        const senderIsHost = current.peers.some((param) => param.id === senderPeerId && param.isHost);
        if (!current.isHost && senderIsHost && peer.color && peer.color !== current.localColor) {
            collaborationStore.set({ ...current, localColor: peer.color });
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
        const merged: CollaborationPeer = {
            ...peer,
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

function removePeer(peerId: PeerId): void {
    collaborationStore.update((state) => {
        if (!state) {
            return state;
        }
        return { ...state, peers: state.peers.filter((param) => param.id !== peerId) };
    });
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
        // Legacy uncompressed invite: plain base64 JSON.
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
