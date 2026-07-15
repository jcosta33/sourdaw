import { type PresenceDelta } from '../../models/CollaborationTypes';

import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export function onPresence(listener: (data: PresenceDelta) => void): () => void {
    runtime.state.presenceListeners.add(listener);
    return () => {
        runtime.state.presenceListeners.delete(listener);
    };
}
