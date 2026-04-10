import { createStore } from '#/infra/store/createStore';

import { type CollaborationState } from '../useCases/collaborationQueries';

const initialState: CollaborationState = {
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

export const collaborationStore = createStore<CollaborationState>({
    initialData: initialState,
});
