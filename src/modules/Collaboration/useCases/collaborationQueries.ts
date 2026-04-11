/**
 * Collaboration Queries — use case layer exposing collaboration state
 * to cross-module consumers.
 */

import { inject } from '#/infra/di/inject';
import { collaborationStore } from '../stores/collaborationStore';
import {
    type PeerInfo,
    type CollaborationState,
    type PresenceData,
} from '../models/CollaborationTypes';

export type CollaborationPeer = PeerInfo;
export type PresenceView = 'arrangement' | 'mixer' | 'piano-roll' | 'device';
export type { CollaborationState, PresenceData };

/** Get the current collaboration store value. */
export const getCollaborationStoreValue = inject({ collaborationStore })(
    ({ collaborationStore }) =>
        function getCollaborationStoreValue(): typeof collaborationStore.value {
            return collaborationStore.value;
        }
);
