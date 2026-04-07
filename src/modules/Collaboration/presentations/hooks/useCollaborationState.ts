import { useStore } from '#/infra/store/useStore';

import { collaborationStore } from '../../stores/collaborationStore';
import { type CollaborationState } from '../../models/CollaborationTypes';

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
};

export const useCollaborationState = (): CollaborationState => {
    return useStore<CollaborationState>(collaborationStore, defaultState);
};
