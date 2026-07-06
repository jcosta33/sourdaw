import { type AutomationPoint } from '../models/Automation';
import { type AutomationStoreState } from '../stores/automationStore';

export type DrawSession = {
    laneId: string;
    gridResolution: number;
    constrainHorizontal: boolean;
    initialValue: number | null;
    drawnBeats: Set<number>;
    previousPoints: AutomationPoint[];
    /** Accumulated lane state from the latest paintDrawPoint call, flushed to the
     *  CRDT store at most once per animation frame to avoid O(N) CRDT mutations. */
    pendingState: AutomationStoreState | null;
    /** requestAnimationFrame handle for the deferred store write, or null if idle. */
    rafId: number | null;
};

export const automationDrawModeState: { activeSession: DrawSession | null } = {
    activeSession: null,
};
