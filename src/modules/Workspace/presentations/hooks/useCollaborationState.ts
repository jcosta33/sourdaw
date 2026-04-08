import { useStore } from '#/infra/store/useStore';
import { collaborationStore, type CollaborationState } from '#/modules/Collaboration';

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
    return useStore(collaborationStore, defaultState);
};
