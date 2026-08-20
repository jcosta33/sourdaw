import { collaborationStore } from '../../stores/collaborationStore';

import { joinAttemptAuthority } from './joinAttemptAuthority';
import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export function createSession(name: string): string {
    joinAttemptAuthority.invalidate();
    runtime.cleanup();

    const peerId = runtime.generatePeerId();
    const sessionId = runtime.generateSessionId();
    const color = runtime.pickPeerColor([]);

    runtime.initialize();
    runtime.startPlayheadBroadcast();
    runtime.startBranchSync(true);

    collaborationStore.set({
        isEnabled: true,
        sessionId,
        localPeerId: peerId,
        localName: name,
        localColor: color,
        isHost: true,
        peers: [],
        connectionStatus: 'disconnected',
        error: null,
        quarantinedPeerIds: [],
    });

    return sessionId;
}
