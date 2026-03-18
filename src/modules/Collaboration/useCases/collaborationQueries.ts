/**
 * Collaboration Queries — use case layer exposing collaboration state
 * to cross-module consumers.
 */

import { collaborationStore } from '../stores/collaborationStore';

/** Get the current collaboration store value. */
export function getCollaborationStoreValue(): typeof collaborationStore.value {
    return collaborationStore.value;
}
