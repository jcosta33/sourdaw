import { createCollaborationError } from '../../errors/CollaborationError';
import { type SignalingMessage } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';

import { clearCollaborationFailure } from './clearCollaborationFailure';
import { joinAttemptAuthority } from './joinAttemptAuthority';
import { recordCollaborationFailure } from './recordCollaborationFailure';
import { sessionRuntimePrimitives as runtime } from './sessionManagement';

function createSupersededOperationError(): Error {
    return createCollaborationError('Invite generation was superseded by a newer session');
}

let currentInviteRequest = 0;

/**
 * Mint an invite string for one joiner slot.
 *
 * **An invite grants unconditional write access.** The returned string is a
 * bearer credential: whoever holds it can complete the handshake and, once
 * connected, edit the project without restriction — add, modify and delete
 * tracks, clips and devices — and their changes merge into every peer's
 * document. There are no roles, no read-only or listen-only mode, no
 * per-peer capabilities and no host approval step between joining and
 * writing. The only asymmetry left is that branch metadata (`__branches__`)
 * is host-authoritative; see `buildAutomergeSyncHooks` in `sessionManagement`.
 *
 * This is deliberate, not an oversight: a role scaffold (`viewer`,
 * `transport-controller`, capability checks) existed here and was deleted
 * under ADR 0016 ruling 4 because it was unreachable and only ever granted
 * `editor`. Treat an invite as you would a write-capable share link — the
 * way to un-invite someone is to end the session.
 *
 * The invite also carries the session's relay capability, so it is the single
 * thing a joiner needs whether the session runs peer-to-peer or through the
 * WebSocket relay.
 */
export async function generateInvite(): Promise<string> {
    const owner = runtime.captureOwner();
    const requestWitness = joinAttemptAuthority.capture();
    currentInviteRequest += 1;
    const inviteRequest = currentInviteRequest;
    const isCurrentSession = () =>
        joinAttemptAuthority.isCurrent(requestWitness) &&
        (owner === null ? runtime.captureOwner() === null : runtime.canWrite(owner));
    let ownsPendingSlot = () => false;
    let cleanupPendingSlot: () => void = () => undefined;
    let pendingSlotCreated = false;
    clearCollaborationFailure();
    try {
        const peerManager = runtime.state.peerManager;
        const sessionSecret = runtime.state.sessionSecret;
        if (!peerManager || !sessionSecret) {
            throw createCollaborationError('No active session');
        }

        // Clean up any previously generated invite that was never answered.
        if (runtime.state.pendingInviteId) {
            peerManager.removePeer(runtime.state.pendingInviteId);
            runtime.state.pendingInviteId = null;
        }

        const joinerPeerId = runtime.generatePeerId();
        runtime.state.pendingInviteId = joinerPeerId;
        pendingSlotCreated = true;
        ownsPendingSlot = () =>
            runtime.state.peerManager === peerManager && runtime.state.pendingInviteId === joinerPeerId;
        cleanupPendingSlot = () => {
            if (ownsPendingSlot()) {
                runtime.state.pendingInviteId = null;
            }
        };
        const peer = peerManager.createPeer(joinerPeerId);
        ownsPendingSlot = () =>
            runtime.state.peerManager === peerManager &&
            runtime.state.pendingInviteId === joinerPeerId &&
            peerManager.getPeer(joinerPeerId) === peer;
        cleanupPendingSlot = () => {
            if (peerManager.getPeer(joinerPeerId) === peer) {
                peerManager.removePeer(joinerPeerId);
            }
            if (runtime.state.peerManager === peerManager && runtime.state.pendingInviteId === joinerPeerId) {
                runtime.state.pendingInviteId = null;
            }
        };
        const isCurrentInvite = () => isCurrentSession() && currentInviteRequest === inviteRequest && ownsPendingSlot();
        const sdp = await peer.createOffer();
        if (!isCurrentInvite()) {
            throw createSupersededOperationError();
        }

        const state = collaborationStore.value!;
        const invite: SignalingMessage = {
            type: 'offer',
            peerId: state.localPeerId!,
            name: state.localName,
            sessionId: state.sessionId!,
            sdp,
            pendingPeerId: joinerPeerId,
            sessionSecret,
        };

        const compressedInvite = await runtime.compressInvite(JSON.stringify(invite));
        if (!isCurrentInvite()) {
            throw createSupersededOperationError();
        }
        return compressedInvite;
    } catch (error) {
        if (
            !isCurrentSession() ||
            currentInviteRequest !== inviteRequest ||
            (pendingSlotCreated && !ownsPendingSlot())
        ) {
            throw createSupersededOperationError();
        }
        cleanupPendingSlot();
        recordCollaborationFailure(error);
        throw error;
    }
}
