import { createCollaborationError } from '../../errors/CollaborationError';
import { type SignalingMessage, PEER_COLORS, sanitizePeerName } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';

import { joinAttemptAuthority } from './joinAttemptAuthority';
import { getCollaborationAssetOwnerId } from './getCollaborationAssetOwnerId';
import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export async function joinSession(inviteString: string, name: string): Promise<string> {
    runtime.cleanup();
    const joinAttempt = joinAttemptAuthority.begin();
    collaborationStore.set({
        isEnabled: true,
        sessionId: null,
        localPeerId: null,
        localName: name,
        localColor: '',
        isHost: false,
        peers: [],
        connectionStatus: 'connecting',
        error: null,
        quarantinedPeerIds: [],
    });

    let runtimeStarted = false;
    try {
        if (!inviteString.trim()) {
            throw createCollaborationError('Invite string is empty');
        }

        let decompressedInvite: string;
        try {
            decompressedInvite = await runtime.decompressInvite(inviteString.trim());
        } catch {
            throw createCollaborationError('Invalid invite — must be a valid invite string');
        }
        if (!joinAttemptAuthority.isCurrent(joinAttempt)) {
            throw createCollaborationError('Join attempt was superseded');
        }

        let invite: SignalingMessage;
        try {
            invite = JSON.parse(decompressedInvite) as SignalingMessage;
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
                    // Invite payloads are sender-controlled — bound the host
                    // name with the same limit every identity ingress uses.
                    name: sanitizePeerName(invite.name),
                    color: PEER_COLORS[0],
                    isHost: true,
                    isConnected: false,
                    lastSeen: Date.now(),
                    latencyMs: null,
                },
            ],
            connectionStatus: 'connecting',
            error: null,
            quarantinedPeerIds: [],
        });

        runtimeStarted = true;
        const peerManager = runtime.initialize(getCollaborationAssetOwnerId());
        runtime.startPlayheadBroadcast();
        runtime.startBranchSync(false);

        const peer = peerManager.createPeer(invite.peerId);
        const answerSdp = await peer.acceptOffer(invite.sdp);
        if (!joinAttemptAuthority.isCurrent(joinAttempt)) {
            throw createCollaborationError('Join attempt was superseded');
        }

        const answer: SignalingMessage = {
            type: 'answer',
            peerId,
            name,
            sdp: answerSdp,
            pendingPeerId: invite.pendingPeerId,
        };

        const compressedAnswer = await runtime.compressInvite(JSON.stringify(answer));
        if (!joinAttemptAuthority.isCurrent(joinAttempt)) {
            throw createCollaborationError('Join attempt was superseded');
        }
        return compressedAnswer;
    } catch (error) {
        if (!joinAttemptAuthority.isCurrent(joinAttempt)) {
            throw error;
        }
        if (runtimeStarted) {
            runtime.cleanup();
        }
        collaborationStore.set({
            isEnabled: false,
            sessionId: null,
            localPeerId: null,
            localName: '',
            localColor: '',
            isHost: false,
            peers: [],
            connectionStatus: 'error',
            error: error instanceof Error ? error.message : String(error),
            quarantinedPeerIds: [],
        });
        throw error;
    }
}
