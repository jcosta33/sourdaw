// presentations/views/CollaborationPanel.tsx
export { CollaborationPanel } from './presentations/views/CollaborationPanel';

// presentations/views/PresenceOverlay.tsx
export { PresenceOverlay } from './presentations/views/PresenceOverlay';

// stores/collaborationStore.ts
export { collaborationStore } from './stores/collaborationStore';

// useCases/collaborationQueries.ts
export type { CollaborationPeer, CollaborationState, PresenceData, PresenceView } from './useCases/collaborationQueries';

// useCases/collaboration/sessionManagement.ts
export {
    createSession,
    generateInvite,
    joinSession,
    acceptAnswer,
    leaveSession,
    broadcastPresence,
    onPresence,
    getAssetTransfer,
    getPermissionManager,
} from './useCases/collaboration/sessionManagement';

// useCases/getCollaborationHandlers.ts
export { getCollaborationHandlers } from './useCases/getCollaborationHandlers';
