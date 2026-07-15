import { createCollaborationError } from '../../errors/CollaborationError';
import { type SignalingMessage } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';

import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export async function generateInvite(): Promise<string> {
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

    return runtime.compressInvite(JSON.stringify(invite));
}
