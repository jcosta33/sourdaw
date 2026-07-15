import { collaborationStore } from '../../stores/collaborationStore';

import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export function createSession(name: string): string {
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
    });

    return sessionId;
}
