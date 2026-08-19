import { createCollaborationError } from '../../errors/CollaborationError';
import { type SignalingMessage } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';
import { type CollaborationPeer } from '../collaborationQueries';

import { clearCollaborationFailure } from './clearCollaborationFailure';
import { recordCollaborationFailure } from './recordCollaborationFailure';
import { sessionRuntimePrimitives as runtime } from './sessionManagement';

/**
 * Pins a surfaced failure to the accept attempt that is still live.
 *
 * The panel's accept button carries no in-flight guard, so a double-click runs
 * two `acceptAnswer` calls against the same pending peer. The first applies the
 * remote description and connects the joiner; the second then rejects, because
 * the peer connection has already left the signaling state that accepts an
 * answer. Reporting that rejection would tell the host the join failed while
 * the joiner is connected, so only an attempt that is still current when it
 * fails may write the error row. Both beginning a newer attempt and settling
 * one successfully retire every attempt already in flight. The rejection still
 * reaches the caller either way — this gates the store write, not the throw.
 *
 * Mirrors `joinAttemptAuthority`, which gates `joinSession`'s failure write the
 * same way; that one is shared because session lifecycle use cases invalidate
 * it, while accept attempts are only ever superseded from here.
 */
let currentAcceptAttempt = 0;

const acceptAttemptAuthority = {
    begin(): number {
        currentAcceptAttempt += 1;
        return currentAcceptAttempt;
    },
    settle(): void {
        currentAcceptAttempt += 1;
    },
    isCurrent(attempt: number): boolean {
        return attempt === currentAcceptAttempt;
    },
};

export async function acceptAnswer(answerString: string): Promise<void> {
    clearCollaborationFailure();
    const acceptAttempt = acceptAttemptAuthority.begin();
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
        acceptAttemptAuthority.settle();
    } catch (error) {
        if (acceptAttemptAuthority.isCurrent(acceptAttempt)) {
            recordCollaborationFailure(error);
        }
        throw error;
    }
}
