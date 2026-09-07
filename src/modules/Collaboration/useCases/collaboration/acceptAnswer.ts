import { createCollaborationError } from '../../errors/CollaborationError';
import { type SignalingMessage, sanitizePeerName } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';
import { type CollaborationPeer } from '../collaborationQueries';

import { clearCollaborationFailure } from './clearCollaborationFailure';
import { joinAttemptAuthority } from './joinAttemptAuthority';
import { recordCollaborationFailure } from './recordCollaborationFailure';
import { sessionRuntimePrimitives as runtime } from './sessionManagement';

function createSupersededOperationError(): Error {
    return createCollaborationError('Answer acceptance was superseded by a newer session');
}

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

type PeerManager = NonNullable<typeof runtime.state.peerManager>;
type PendingPeer = ReturnType<PeerManager['getPeer']>;

function getPendingPeer(peerManager: PeerManager | null, pendingId: string | null): PendingPeer {
    if (!peerManager || !pendingId) {
        return undefined;
    }
    return peerManager.getPeer(pendingId);
}

function isCurrentSession(
    owner: ReturnType<typeof runtime.captureOwner>,
    requestWitness: ReturnType<typeof joinAttemptAuthority.capture>,
    peerManager: PeerManager | null
): boolean {
    if (!joinAttemptAuthority.isCurrent(requestWitness) || runtime.state.peerManager !== peerManager) {
        return false;
    }
    return owner === null ? runtime.captureOwner() === null : runtime.canWrite(owner);
}

function matchesOriginalPendingPeer(
    answer: SignalingMessage,
    originalPendingId: string | null,
    pendingPeer: PendingPeer
): pendingPeer is NonNullable<PendingPeer> {
    return originalPendingId === answer.pendingPeerId && pendingPeer !== undefined;
}

function isPeerMapped(peerManager: PeerManager | null, peerId: string | null, pendingPeer: PendingPeer): boolean {
    return peerId !== null && peerManager?.getPeer(peerId) === pendingPeer;
}

function removePeerIfMapped(peerManager: PeerManager, peerId: string | null, pendingPeer: PendingPeer): void {
    if (peerId === null || !isPeerMapped(peerManager, peerId, pendingPeer)) {
        return;
    }
    peerManager.removePeer(peerId);
}

function appendAnsweredPeer(answer: SignalingMessage): void {
    collaborationStore.update((current) => {
        if (!current || current.peers.some((peer) => peer.id === answer.peerId)) {
            return current;
        }
        const joinerInfo: CollaborationPeer = {
            id: answer.peerId,
            // Answer payloads are sender-controlled — bound the joiner name
            // with the same limit every identity ingress uses.
            name: sanitizePeerName(answer.name),
            color: runtime.pickPeerColor([current.localColor, ...current.peers.map((peer) => peer.color)]),
            isHost: false,
            isConnected: false,
            lastSeen: Date.now(),
            latencyMs: null,
            syncHealth: current.quarantinedPeerIds.includes(answer.peerId) ? 'diverged' : 'converging',
        };
        return { ...current, peers: [...current.peers, joinerInfo] };
    });
}

export async function acceptAnswer(answerString: string): Promise<void> {
    const owner = runtime.captureOwner();
    const requestWitness = joinAttemptAuthority.capture();
    const peerManager = runtime.state.peerManager;
    const originalPendingId = runtime.state.pendingInviteId;
    const pendingPeer = getPendingPeer(peerManager, originalPendingId);
    clearCollaborationFailure();
    const acceptAttempt = acceptAttemptAuthority.begin();
    let peerIdentitySuperseded = false;
    try {
        let json: string;
        try {
            json = await runtime.decompressInvite(answerString);
        } catch {
            throw createCollaborationError('Invalid answer — must be a valid answer string');
        }
        if (!isCurrentSession(owner, requestWitness, peerManager)) {
            throw createSupersededOperationError();
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

        if (!peerManager) {
            throw createCollaborationError('No active session');
        }
        if (!matchesOriginalPendingPeer(answer, originalPendingId, pendingPeer)) {
            throw createCollaborationError(
                'No pending peer connection matches this answer — the invite may have expired'
            );
        }

        if (!isPeerMapped(peerManager, originalPendingId, pendingPeer)) {
            peerIdentitySuperseded = true;
            throw createSupersededOperationError();
        }

        const state = collaborationStore.value;
        if (state && answer.peerId === state.localPeerId) {
            removePeerIfMapped(peerManager, originalPendingId, pendingPeer);
            throw createCollaborationError(
                'Invalid answer — peer ID is already in use by another session peer or the host'
            );
        }

        if (answer.pendingPeerId !== answer.peerId) {
            const rekeyed = peerManager.rekeyPeer(answer.pendingPeerId, answer.peerId, state?.localPeerId);
            if (!rekeyed) {
                removePeerIfMapped(peerManager, originalPendingId, pendingPeer);
                throw createCollaborationError(
                    'Invalid answer — peer ID is already in use by another session peer or the host'
                );
            }
        }

        await pendingPeer.acceptAnswer(answer.sdp);
        if (
            !isCurrentSession(owner, requestWitness, peerManager) ||
            !isPeerMapped(peerManager, answer.peerId, pendingPeer)
        ) {
            peerIdentitySuperseded = true;
            throw createSupersededOperationError();
        }
        if (runtime.state.pendingInviteId === originalPendingId) {
            runtime.state.pendingInviteId = null;
        }

        appendAnsweredPeer(answer);
        acceptAttemptAuthority.settle();
    } catch (error) {
        if (!isCurrentSession(owner, requestWitness, peerManager) || peerIdentitySuperseded) {
            throw createSupersededOperationError();
        }
        if (acceptAttemptAuthority.isCurrent(acceptAttempt)) {
            recordCollaborationFailure(error);
        }
        throw error;
    }
}
