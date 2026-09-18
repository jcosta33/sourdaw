import { type PeerMessage } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';

import { joinAttemptAuthority } from './joinAttemptAuthority';
import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export async function leaveSession(): Promise<void> {
    return runtime.runLifecycle(async () => {
        const owner = runtime.captureOwner();
        const state = collaborationStore.value;
        if (!owner && !state?.isEnabled) {
            await runtime.settleRetainedTeardown();
            return;
        }
        if (!owner || runtime.canWrite(owner)) {
            joinAttemptAuthority.invalidate();
        }
        const requestWitness = joinAttemptAuthority.capture();
        const peerManager = owner?.peerManager ?? null;
        const localPeerId = state?.localPeerId ?? '';
        runtime.retire(owner);
        if (peerManager) {
            const leaveMessage: PeerMessage = {
                type: 'peer-leave',
                peerId: localPeerId,
            };
            // Drain only the sends captured for this outgoing runtime. The
            // transport closes before durable storage settlement begins.
            await Promise.all(
                peerManager
                    .getConnectedPeerIds()
                    .map((peerId) =>
                        peerManager.sendCrdtSyncBuffered({ peerId, message: leaveMessage }).catch(() => undefined)
                    )
            );
        }

        runtime.closeTransport(owner);
        const removedCurrentRuntime = runtime.cleanup(owner, requestWitness, { closeTransport: false });
        if (!removedCurrentRuntime) {
            await runtime.settleRetainedTeardown();
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
        await runtime.settleRetainedTeardown();
    });
}
