import { logger } from '#/infra/logger/appLogger';

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

    let owner: ReturnType<typeof runtime.captureOwner> = null;
    try {
        runtime.initialize(collaborationAssetOwnership.getOwnerId());
        owner = runtime.captureOwner();
        runtime.startPlayheadBroadcast();
        runtime.startBranchSync(true);
    } catch (error) {
        runtime.retire(owner);
        try {
            runtime.cleanup(owner);
        } catch (cleanupError) {
            logger.warn('[Collaboration] Failed to clean up host session setup:', cleanupError);
        }
        throw error;
    }

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
