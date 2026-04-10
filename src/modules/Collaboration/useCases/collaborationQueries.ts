/**
 * Collaboration Queries — use case layer exposing collaboration state
 * to cross-module consumers.
 */

import { inject } from '#/infra/di/inject';
import { collaborationStore } from '../stores/collaborationStore';
import { type CollaborationState } from '../models/CollaborationTypes';

export type { CollaborationState };

export const getCollaborationStoreValueDependencies = {
    collaborationStore,
} as const;

/** Get the current collaboration store value. */
export const getCollaborationStoreValue = inject(getCollaborationStoreValueDependencies)(
    ({ collaborationStore: collaborationStoreDep }) =>
        function getCollaborationStoreValue(): typeof collaborationStoreDep.value {
            return collaborationStoreDep.value;
        }
);
