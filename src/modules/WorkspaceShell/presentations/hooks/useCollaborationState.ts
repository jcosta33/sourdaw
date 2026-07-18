import { useStore } from '#/infra/store/useStore';
import { collaborationStore } from '#/modules/Collaboration/stores';

type CollaborationViewState = {
    isEnabled: boolean;
    sessionId: string | null;
    localPeerId: string | null;
    localName: string;
    localColor: string;
    isHost: boolean;
    peers: Array<{
        id: string;
        name: string;
        color: string;
        isConnected: boolean;
        isHost: boolean;
    }>;
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
    error: string | null;
};

const defaultState: CollaborationViewState = {
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

export const useCollaborationState = (): CollaborationViewState => {
    return useStore(collaborationStore, defaultState);
};
