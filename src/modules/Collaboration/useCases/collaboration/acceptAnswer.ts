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
    settle(attempt: number): void {
        if (attempt === currentAcceptAttempt) {
            currentAcceptAttempt += 1;
        }
    },
    isCurrent(attempt: number): boolean {
        return attempt === currentAcceptAttempt;
    },
};

type PeerManager = NonNullable<typeof runtime.state.peerManager>;
type PendingPeer = ReturnType<PeerManager['getPeer']>;
type ActiveAcceptance = {
    token: symbol;
    pendingId: string;
    peer: NonNullable<PendingPeer>;
    confirmedPeerId: string | null;
};

const activeAcceptances = new Map<PeerManager, Map<string, ActiveAcceptance>>();

function getActiveAcceptance(peerManager: PeerManager, pendingId: string): ActiveAcceptance | undefined {
    return activeAcceptances.get(peerManager)?.get(pendingId);
}

function admitAcceptance(
    peerManager: PeerManager | null,
    pendingId: string | null,
    peer: PendingPeer
): ActiveAcceptance | undefined {
    if (!peerManager || !pendingId || !peer) {
        return undefined;
    }
    const activeAcceptance: ActiveAcceptance = {
        token: Symbol('active acceptance'),
        pendingId,
        peer,
        confirmedPeerId: null,
    };
    const acceptances = activeAcceptances.get(peerManager) ?? new Map<string, ActiveAcceptance>();
    acceptances.set(pendingId, activeAcceptance);
    activeAcceptances.set(peerManager, acceptances);
    return activeAcceptance;
}

function releaseAcceptance(peerManager: PeerManager | null, activeAcceptance: ActiveAcceptance | undefined): void {
    if (!peerManager || !activeAcceptance) {
        return;
    }
    const acceptances = activeAcceptances.get(peerManager);
    if (acceptances?.get(activeAcceptance.pendingId)?.token !== activeAcceptance.token) {
        return;
    }
    acceptances.delete(activeAcceptance.pendingId);
    if (acceptances.size === 0) {
        activeAcceptances.delete(peerManager);
    }
}

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

function removePeerIfMapped(peerManager: PeerManager, peerId: string | null, pendingPeer: PendingPeer): boolean {
    if (peerId === null || !isPeerMapped(peerManager, peerId, pendingPeer)) {
        return false;
    }
    peerManager.removePeer(peerId);
    return true;
}

function ownsActivePeer(peerManager: PeerManager, activeAcceptance: ActiveAcceptance): boolean {
    const peerId = activeAcceptance.confirmedPeerId ?? activeAcceptance.pendingId;
    return (
        getActiveAcceptance(peerManager, activeAcceptance.pendingId)?.token === activeAcceptance.token &&
        isPeerMapped(peerManager, peerId, activeAcceptance.peer)
    );
}

function isActiveAcceptanceCurrent(
    peerManager: PeerManager | null,
    activeAcceptance: ActiveAcceptance | undefined
): boolean {
    return !activeAcceptance || (peerManager !== null && ownsActivePeer(peerManager, activeAcceptance));
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

async function decodeAnswer(answerString: string): Promise<SignalingMessage> {
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
    return answer;
}

function conflictsWithLocalPeer(answer: SignalingMessage, state: typeof collaborationStore.value): boolean {
    return state?.localPeerId === answer.peerId;
}

function rekeyPendingPeer(
    peerManager: PeerManager,
    answer: SignalingMessage,
    localPeerId: string | null | undefined
): boolean {
    return (
        answer.pendingPeerId === answer.peerId ||
        peerManager.rekeyPeer(answer.pendingPeerId, answer.peerId, localPeerId)
    );
}

export async function acceptAnswer(answerString: string): Promise<void> {
    const owner = runtime.captureOwner();
    const requestWitness = joinAttemptAuthority.capture();
    const peerManager = runtime.state.peerManager;
    const originalPendingId = runtime.state.pendingInviteId;
    const pendingPeer = getPendingPeer(peerManager, originalPendingId);
    if (peerManager && originalPendingId && getActiveAcceptance(peerManager, originalPendingId)) {
        throw createSupersededOperationError();
    }
    const activeAcceptance = admitAcceptance(peerManager, originalPendingId, pendingPeer);
    clearCollaborationFailure();
    const acceptAttempt = acceptAttemptAuthority.begin();
    let removedCurrentPeer = false;
    const isCurrentAcceptance = () =>
        isCurrentSession(owner, requestWitness, peerManager) &&
        isActiveAcceptanceCurrent(peerManager, activeAcceptance);
    try {
        const answer = await decodeAnswer(answerString);
        if (!isCurrentAcceptance()) {
            throw createSupersededOperationError();
        }

        if (!peerManager) {
            throw createCollaborationError('No active session');
        }
        if (!matchesOriginalPendingPeer(answer, originalPendingId, pendingPeer)) {
            throw createCollaborationError(
                'No pending peer connection matches this answer — the invite may have expired'
            );
        }

        if (!activeAcceptance || !ownsActivePeer(peerManager, activeAcceptance)) {
            throw createSupersededOperationError();
        }

        const state = collaborationStore.value;
        if (conflictsWithLocalPeer(answer, state)) {
            removedCurrentPeer = removePeerIfMapped(peerManager, originalPendingId, pendingPeer);
            throw createCollaborationError(
                'Invalid answer — peer ID is already in use by another session peer or the host'
            );
        }

        if (!rekeyPendingPeer(peerManager, answer, state?.localPeerId)) {
            removedCurrentPeer = removePeerIfMapped(peerManager, originalPendingId, pendingPeer);
            throw createCollaborationError(
                'Invalid answer — peer ID is already in use by another session peer or the host'
            );
        }
        activeAcceptance.confirmedPeerId = answer.peerId;
        if (!ownsActivePeer(peerManager, activeAcceptance)) {
            throw createSupersededOperationError();
        }

        await pendingPeer.acceptAnswer(answer.sdp);
        if (!isCurrentAcceptance()) {
            throw createSupersededOperationError();
        }
        if (runtime.state.pendingInviteId === originalPendingId) {
            runtime.state.pendingInviteId = null;
        }

        appendAnsweredPeer(answer);
        acceptAttemptAuthority.settle(acceptAttempt);
    } catch (error) {
        if (!isCurrentSession(owner, requestWitness, peerManager) || (!removedCurrentPeer && !isCurrentAcceptance())) {
            throw createSupersededOperationError();
        }
        if (acceptAttemptAuthority.isCurrent(acceptAttempt)) {
            recordCollaborationFailure(error);
        }
        throw error;
    } finally {
        releaseAcceptance(peerManager, activeAcceptance);
    }
}
