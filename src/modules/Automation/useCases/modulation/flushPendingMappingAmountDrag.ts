import { mappingAmountDragKey, mappingAmountDragState, type MappingAmountDragSession } from './mappingAmountDragState';
import { updateMapping } from './updateMapping';

/** Flush one session's accumulated drag amount to the CRDT store. */
export function flushPendingMappingAmountDrag(session: MappingAmountDragSession): void {
    if (session.pendingAmount === null) {
        return;
    }
    // A session that was ended or replaced since its frame was scheduled must
    // not write — its gesture is closed and the slot may belong to another one.
    if (
        mappingAmountDragState.activeSessions.get(mappingAmountDragKey(session.modulatorId, session.target)) !== session
    ) {
        return;
    }

    updateMapping(session.modulatorId, session.target, { amount: session.pendingAmount });
    session.pendingAmount = null;
    session.rafId = null;
}
