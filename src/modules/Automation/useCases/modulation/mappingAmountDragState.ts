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

export const mappingAmountDragState: { activeSession: MappingAmountDragSession | null } = {
    activeSession: null,
};
