import { type MappingTarget } from './removeMapping';

export type MappingAmountDragSession = {
    modulatorId: string;
    target: MappingTarget;
    /** Amount before the gesture began — the undo restore point for the whole drag. */
    previousAmount: number;
    /** Latest amount from the drag, flushed to the CRDT store at most once per
     *  animation frame — the modulation-amount counterpart of `DrawSession.pendingState`.
     *  Without this coalescing, every tick of a slider drag is a separate Automerge
     *  change (CRDT traffic per pixel in a collaborative session). */
    pendingAmount: number | null;
    /** requestAnimationFrame handle for the deferred store write, or null if idle. */
    rafId: number | null;
};

/**
 * One slot per mapping, not one global session: two pointers can drag two
 * sliders at once (implicit pointer capture keeps each input firing its own
 * change events), and a single slot would route the second gesture's values
 * into the first mapping.
 */
export const mappingAmountDragState: { activeSessions: Map<string, MappingAmountDragSession> } = {
    activeSessions: new Map(),
};

export function mappingAmountDragKey(modulatorId: string, target: MappingTarget): string {
    return [modulatorId, target.targetTrackId, target.targetDeviceId, target.targetParamId].join(' ');
}
