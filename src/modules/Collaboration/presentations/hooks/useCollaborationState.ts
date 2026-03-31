import { useSyncExternalStore } from 'react';

import { collaborationStore } from '../../stores/collaborationStore';
import { type CollaborationState } from '../../models/CollaborationTypes';

const defaultState: CollaborationState = {
    isEnabled: false,
    sessionId: null,
    localPeerId: null,
    localName: '',
    localColor: '',
    isHost: false,
    approvalRequired: false,
    pendingJoinRequests: [],
    peers: [],
    connectionStatus: 'disconnected',
    error: null,
};

export const useCollaborationState = (): CollaborationState => {
    return useSyncExternalStore(
        (onChange) => collaborationStore.subscribe(() => onChange()),
        () => collaborationStore.value ?? defaultState,
        () => collaborationStore.value ?? defaultState
    );
};
