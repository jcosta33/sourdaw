import { logger } from '#/infra/logger/appLogger';

import { createCollaborationError } from '../../errors/CollaborationError';
import { type SignalingMessage, PEER_COLORS, sanitizePeerName } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';

import { collaborationAssetOwnership } from './getCollaborationAssetOwnerId';
import { joinAttemptAuthority } from './joinAttemptAuthority';
import { sessionRuntimePrimitives as runtime } from './sessionManagement';

async function parseInvite(inviteString: string): Promise<Extract<SignalingMessage, { type: 'offer' }>> {
    if (!inviteString.trim()) {
        throw createCollaborationError('Invite string is empty');
    }

    let decompressedInvite: string;
    try {
        decompressedInvite = await runtime.decompressInvite(inviteString.trim());
    } catch {
        throw createCollaborationError('Invalid invite — must be a valid invite string');
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
    return invite;
}

export async function joinSession(inviteString: string, name: string): Promise<string> {
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
    const invitePreparation = parseInvite(inviteString).then(
        (invite) => ({ status: 'ready' as const, invite }),
        (error: unknown) => ({ status: 'failed' as const, error })
    );
    let installedOwner: ReturnType<typeof runtime.captureOwner> = null;

    try {
        await runtime.runLifecycle(async () => {
            const outgoingOwner = runtime.captureOwner();
            const outgoingRequestWitness = joinAttemptAuthority.capture();
            runtime.cleanup(outgoingOwner, outgoingRequestWitness);
            await runtime.settleRetainedTeardown();
        });
        const prepared = await invitePreparation;
        if (prepared.status === 'failed') {
            throw prepared.error;
        }
        if (!joinAttemptAuthority.isCurrent(joinAttempt)) {
            throw createCollaborationError('Join attempt was superseded');
        }
        const invite = prepared.invite;
        const { peerId, peer } = await runtime.runLifecycle(async () => {
            if (!joinAttemptAuthority.isCurrent(joinAttempt)) {
                throw createCollaborationError('Join attempt was superseded');
            }
            const settledAssetOwnerId = collaborationAssetOwnership.getOwnerId();
            const peerId = invite.pendingPeerId ?? runtime.generatePeerId();
            runtime.state.sessionSecret = invite.sessionSecret ?? null;
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
                        name: sanitizePeerName(invite.name),
                        color: PEER_COLORS[0],
                        isHost: true,
                        isConnected: false,
                        lastSeen: Date.now(),
                        latencyMs: null,
                        syncHealth: 'converging',
                    },
                ],
                connectionStatus: 'connecting',
                error: null,
                quarantinedPeerIds: [],
            });

            const peerManager = await runtime.initialize(
                `collaboration-join:${invite.sessionId}:${peerId}:${joinAttempt}`,
                {
                    handoffSourceOwnerIds: [settledAssetOwnerId],
                    rebindToSynchronizedOwner: true,
                }
            );
            installedOwner = runtime.captureOwner();
            runtime.startPlayheadBroadcast();
            runtime.startBranchSync(false);
            return { peerId, peer: peerManager.createPeer(invite.peerId) };
        });

        const answerSdp = await peer.acceptOffer(invite.sdp);
        if (!joinAttemptAuthority.isCurrent(joinAttempt) || !installedOwner || !runtime.canWrite(installedOwner)) {
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
        if (!joinAttemptAuthority.isCurrent(joinAttempt) || !runtime.canWrite(installedOwner)) {
            throw createCollaborationError('Join attempt was superseded');
        }
        return compressedAnswer;
    } catch (error) {
        const ownsInstalledRuntime = installedOwner === null || runtime.isInstalled(installedOwner);
        let cleanupError: unknown = null;
        if (installedOwner && ownsInstalledRuntime) {
            try {
                await runtime.runLifecycle(async () => {
                    runtime.cleanup(installedOwner);
                    await runtime.settleRetainedTeardown();
                });
            } catch (error) {
                cleanupError = error;
                logger.warn('[Collaboration] Failed to clean up join session setup:', error);
            }
        }
        if (joinAttemptAuthority.isCurrent(joinAttempt) && ownsInstalledRuntime) {
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
        }
        if (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Join setup and durable cleanup both failed', {
                cause: error,
            });
        }
        throw error;
    }
}
