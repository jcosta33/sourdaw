import { createCollaborationError } from '../../errors/CollaborationError';
import { type SignalingMessage, PEER_COLORS } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';

import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export async function joinSession(inviteString: string, name: string): Promise<string> {
    runtime.cleanup();

    if (!inviteString.trim()) {
        throw createCollaborationError('Invite string is empty');
    }

    let invite: SignalingMessage;
    try {
        const json = await runtime.decompressInvite(inviteString.trim());
        invite = JSON.parse(json) as SignalingMessage;
    } catch {
        throw createCollaborationError('Invalid invite — must be a valid invite string');
    }

    if (invite.type !== 'offer') {
        throw createCollaborationError('Invalid invite: expected offer');
    }

    // Adopt the host-minted pendingPeerId as our session identity. The host
    // keys our PeerConnection by it and lists us in its peer store under
    // answer.peerId; minting our own id here splits the joiner across two
    // identities, so host-side presence, peer-leave, disconnect cleanup, and
    // color assignment all miss their lookups. Fall back to a self-minted id
    // only for legacy invites that predate pendingPeerId.
    const peerId = invite.pendingPeerId ?? runtime.generatePeerId();
    // Pick a color that doesn't clash with the host's (always the first color).
    const color = runtime.pickPeerColor([PEER_COLORS[0]]);

    const peerManager = runtime.initialize();
    runtime.startPlayheadBroadcast();
    runtime.startBranchSync(false);

    const peer = peerManager.createPeer(invite.peerId);
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

    return runtime.compressInvite(JSON.stringify(answer));
}
