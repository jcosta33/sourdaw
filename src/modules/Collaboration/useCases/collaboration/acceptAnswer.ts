import { createCollaborationError } from '../../errors/CollaborationError';
import { type SignalingMessage, sanitizePeerName } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';
import { type CollaborationPeer } from '../collaborationQueries';

import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export async function acceptAnswer(answerString: string): Promise<void> {
    const json = await runtime.decompressInvite(answerString);
    const answer = JSON.parse(json) as SignalingMessage;
    if (answer.type !== 'answer') {
        throw createCollaborationError('Invalid answer');
    }

    const peerManager = runtime.state.peerManager;
    if (!peerManager) {
        throw createCollaborationError('No active session');
    }

    const peer = peerManager.getPeer(answer.pendingPeerId);
    if (!peer) {
        throw createCollaborationError('No pending peer connection matches this answer — the invite may have expired');
    }

    await peer.acceptAnswer(answer.sdp);
    runtime.state.pendingInviteId = null;

    // Add the joiner to our peer list
    const state = collaborationStore.value;
    if (state) {
        const joinerInfo: CollaborationPeer = {
            id: answer.peerId,
            // Answer payloads are sender-controlled — bound the joiner name
            // with the same limit every identity ingress uses.
            name: sanitizePeerName(answer.name),
            color: runtime.pickPeerColor([state.localColor, ...state.peers.map((param) => param.color)]),
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
