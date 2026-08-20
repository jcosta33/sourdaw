import { createStore } from '#/infra/store/createStore';

import { type CollaborationState } from '../models/CollaborationTypes';

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
    quarantinedPeerIds: [],
};

export const collaborationStore = createStore<CollaborationState>({
    initialData: initialState,
});
