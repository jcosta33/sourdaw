import { useStore } from '#/infra/store/useStore';

import { collaborationStore } from '../../stores/collaborationStore';
import { type CollaborationState } from '../../useCases/collaborationQueries';

const defaultState: CollaborationState = {
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
};

export const useCollaborationState = (): CollaborationState => {
    return useStore<CollaborationState>(collaborationStore, defaultState);
};
