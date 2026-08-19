import { createCollaborationError } from '../../errors/CollaborationError';
import { type SignalingMessage } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';

import { clearCollaborationFailure } from './clearCollaborationFailure';
import { recordCollaborationFailure } from './recordCollaborationFailure';
import { sessionRuntimePrimitives as runtime } from './sessionManagement';

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
 */
export async function generateInvite(): Promise<string> {
    clearCollaborationFailure();
    try {
        const peerManager = runtime.state.peerManager;
        if (!peerManager) {
            throw createCollaborationError('No active session');
        }

        // Clean up any previously generated invite that was never answered.
        if (runtime.state.pendingInviteId) {
            peerManager.removePeer(runtime.state.pendingInviteId);
            runtime.state.pendingInviteId = null;
        }

        const joinerPeerId = runtime.generatePeerId();
        runtime.state.pendingInviteId = joinerPeerId;
        const peer = peerManager.createPeer(joinerPeerId);
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

        return await runtime.compressInvite(JSON.stringify(invite));
    } catch (error) {
        recordCollaborationFailure(error);
        throw error;
    }
}
