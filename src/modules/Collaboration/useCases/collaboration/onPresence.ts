import { type PresenceDelta } from '../../models/CollaborationTypes';

import { sessionRuntimePrimitives as runtime } from './sessionManagement';

/**
 * Register an app-lifetime presence observer. The registration is owned by
 * the caller through the returned disposer and survives session teardown, so
 * a subscriber mounted independently of any session (the presence overlay)
 * keeps receiving presence across leave→rejoin cycles.
 */
export function onPresence(listener: (data: PresenceDelta) => void): () => void {
    runtime.presenceListeners.add(listener);
    return () => {
        runtime.presenceListeners.delete(listener);
    };
}
