import { type PeerMessage } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';

import { joinAttemptAuthority } from './joinAttemptAuthority';
import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export async function leaveSession(): Promise<void> {
    joinAttemptAuthority.invalidate();
    const owner = runtime.captureOwner();
    const requestWitness = joinAttemptAuthority.capture();
    const peerManager = runtime.state.peerManager;
    runtime.retire(owner);
    if (peerManager) {
        const leaveMessage: PeerMessage = {
            type: 'peer-leave',
            peerId: collaborationStore.value?.localPeerId ?? '',
        };
        // Drain the send buffer to each connected peer before closing so the
        // leave isn't discarded mid-flight by closeAll().
        await Promise.all(
            peerManager.getConnectedPeerIds().map((peerId) =>
                peerManager.sendCrdtSyncBuffered({ peerId, message: leaveMessage }).catch(() => {
                    // A peer that errors/closes during flush is being torn down
                    // anyway; ignore so the remaining peers still get the leave.
                })
            )
        );
    }

    const removedCurrentRuntime = runtime.cleanup(owner, requestWitness);
    if (!removedCurrentRuntime) {
        return;
    }

    collaborationStore.set({
        isEnabled: false,
        sessionId: null,
        localPeerId: null,
        localName: '',
        localColor: '',
        isHost: false,
        peers: [],
        connectionStatus: 'disconnected',
        error: null,
        quarantinedPeerIds: [],
    });
}
