/**
 * useCollaborationState — local re-implementation using collaborationStore (contract).
 */
import { useSyncExternalStore } from 'react';
import { collaborationStore } from '#/modules/Collaboration/stores/collaborationStore';
import { type CollaborationState } from '#/modules/Collaboration/useCases/collaborationQueries';

const defaultState: CollaborationState = {
    isEnabled: false,
    sessionId: null,
    localPeerId: null,
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
