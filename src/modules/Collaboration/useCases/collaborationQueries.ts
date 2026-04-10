/**
 * Collaboration Queries — use case layer exposing collaboration state
 * to cross-module consumers.
 */

import { inject } from '#/infra/di/inject';
import { collaborationStore } from '../stores/collaborationStore';

export type CollaborationPeer = {
    id: string;
    name: string;
    color: string;
    isHost: boolean;
    isConnected: boolean;
    lastSeen: number;
    latencyMs: number | null;
};

export type PresenceView = 'arrangement' | 'mixer' | 'piano-roll' | 'device';

export type CollaborationState = {
    isEnabled: boolean;
    sessionId: string | null;
    localPeerId: string | null;
    localName: string;
    localColor: string;
    isHost: boolean;
    peers: CollaborationPeer[];
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
    error: string | null;
};

export type PresenceData = {
    peerId: string;
    name: string;
    color: string;
    view: PresenceView;
    cursorBeat: number | null;
    cursorTrackId: string | null;
    selectedClipIds: string[];
    selectedNoteIds: string[];
    viewportStartBeat: number;
    viewportEndBeat: number;
    viewportTrackIds: string[];
    action: string | null;
    playheadBeat: number | null;
};

/** Get the current collaboration store value. */
export const getCollaborationStoreValue = inject({ collaborationStore })(
    ({ collaborationStore }) =>
        function getCollaborationStoreValue(): typeof collaborationStore.value {
            return collaborationStore.value;
        }
);
