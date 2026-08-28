import { flushPendingMappingAmountDrag } from './flushPendingMappingAmountDrag';
import { mappingAmountDragKey, mappingAmountDragState } from './mappingAmountDragState';
import { type MappingTarget } from './removeMapping';

/**
 * Record a new amount during an active drag gesture on one mapping. The store
 * is written at most once per animation frame — the modulation-amount
 * counterpart of `paintDrawPoint`.
 */
export function paintMappingAmountDrag(modulatorId: string, target: MappingTarget, amount: number): void {
    if (!Number.isFinite(amount)) {
        return;
    }
    const session = mappingAmountDragState.activeSessions.get(mappingAmountDragKey(modulatorId, target));
    if (!session) {
        return;
    }

    session.pendingAmount = Math.max(-1, Math.min(1, amount));

    if (session.rafId === null) {
        session.rafId = requestAnimationFrame(() => flushPendingMappingAmountDrag(session));
    }
}
