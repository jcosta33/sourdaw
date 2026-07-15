import { type PresenceDelta } from '../../models/CollaborationTypes';

import { collaborationSessionRuntime } from './sessionManagement';

export function onPresence(listener: (data: PresenceDelta) => void): () => void {
    return collaborationSessionRuntime.onPresence(listener);
}
