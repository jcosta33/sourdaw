import { collaborationStore } from '../stores/collaborationStore';
import {
    type PeerInfo,
    type CollaborationState,
    type PresenceData,
} from '../models/CollaborationTypes';

export type CollaborationPeer = PeerInfo;
export type PresenceView = 'arrangement' | 'mixer' | 'piano-roll' | 'device';
export type { CollaborationState, PresenceData };

export function getCollaborationStoreValue(): typeof collaborationStore.value {
    return collaborationStore.value;
}
