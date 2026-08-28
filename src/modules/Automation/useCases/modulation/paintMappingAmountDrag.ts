import { flushPendingMappingAmountDrag } from './flushPendingMappingAmountDrag';
import { mappingAmountDragState } from './mappingAmountDragState';

/**
 * Record a new amount during an active drag gesture. The store is written at
 * most once per animation frame — the modulation-amount counterpart of
 * `paintDrawPoint`.
 */
export function paintMappingAmountDrag(amount: number): void {
    const activeSession = mappingAmountDragState.activeSession;
    if (activeSession === null || !Number.isFinite(amount)) {
        return;
    }

    activeSession.pendingAmount = Math.max(-1, Math.min(1, amount));

    if (activeSession.rafId === null) {
        activeSession.rafId = requestAnimationFrame(flushPendingMappingAmountDrag);
    }
}
