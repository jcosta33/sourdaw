import { createCollaborationError } from '../../errors/CollaborationError';
import { type SignalingMessage } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';
import { type CollaborationPeer } from '../collaborationQueries';

import { clearCollaborationFailure } from './clearCollaborationFailure';
import { recordCollaborationFailure } from './recordCollaborationFailure';
import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export async function acceptAnswer(answerString: string): Promise<void> {
    clearCollaborationFailure();
    try {
        let json: string;
        try {
            json = await runtime.decompressInvite(answerString);
        } catch {
            throw createCollaborationError('Invalid answer — must be a valid answer string');
        }

        let answer: SignalingMessage;
        try {
            answer = JSON.parse(json) as SignalingMessage;
        } catch {
            throw createCollaborationError('Invalid answer — must be a valid answer string');
        }

        if (answer.type !== 'answer') {
            throw createCollaborationError('Invalid answer');
        }

        const peerManager = runtime.state.peerManager;
        if (!peerManager) {
            throw createCollaborationError('No active session');
        }

        const peer = peerManager.getPeer(answer.pendingPeerId);
        if (!peer) {
            throw createCollaborationError(
                'No pending peer connection matches this answer — the invite may have expired'
            );
        }

        await peer.acceptAnswer(answer.sdp);
        runtime.state.pendingInviteId = null;

        // Add the joiner to our peer list
        const state = collaborationStore.value;
        if (state) {
            const joinerInfo: CollaborationPeer = {
                id: answer.peerId,
                name: answer.name,
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
    } catch (error) {
        recordCollaborationFailure(error);
        throw error;
    }
}
