import { mappingAmountDragState } from './mappingAmountDragState';
import { updateMapping } from './updateMapping';

/** Flush the accumulated drag amount to the CRDT store. */
export function flushPendingMappingAmountDrag(): void {
    const activeSession = mappingAmountDragState.activeSession;
    if (activeSession === null || activeSession.pendingAmount === null) {
        return;
    }

    updateMapping(activeSession.modulatorId, activeSession.target, { amount: activeSession.pendingAmount });
    activeSession.pendingAmount = null;
    activeSession.rafId = null;
}
