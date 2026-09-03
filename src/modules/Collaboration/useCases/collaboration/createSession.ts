import { collaborationStore } from '../../stores/collaborationStore';

import { collaborationAssetOwnership } from './getCollaborationAssetOwnerId';
import { joinAttemptAuthority } from './joinAttemptAuthority';
import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export function createSession(name: string): string {
    joinAttemptAuthority.invalidate();
    runtime.cleanup();

    const peerId = runtime.generatePeerId();
    const sessionId = runtime.generateSessionId();
    const color = runtime.pickPeerColor([]);
    // The room capability every later joiner has to present. `cleanup` above
    // cleared the previous one, so this is the only secret this session has.
    runtime.state.sessionSecret = runtime.generateSessionSecret();

    runtime.initialize(collaborationAssetOwnership.getOwnerId());
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
