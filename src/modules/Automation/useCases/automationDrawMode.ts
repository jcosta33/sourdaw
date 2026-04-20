import { pushUndoEntry } from '#/modules/Command/useCases';

import { type AutomationPoint } from '../models/Automation';
import { automationStore, type AutomationStoreState } from '../stores/automationStore';

type DrawSession = {
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

let activeSession: DrawSession | null = null;

/** Flush the accumulated draw-state to the CRDT store (called by rAF callback). */
function flushPendingState(): void {
    if (!activeSession || !activeSession.pendingState) {
        return;
    }
    automationStore.set(activeSession.pendingState);
    activeSession.pendingState = null;
    activeSession.rafId = null;
}

/**
 * Snap a beat to the nearest grid position.
 */
function snapToGrid(beat: number, gridResolution: number): number {
    return Math.round(beat / gridResolution) * gridResolution;
}

/**
 * Begin a draw-mode painting session.
 */
export function beginDrawSession(laneId: string, gridResolution: number, constrainHorizontal: boolean): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane) {
        return;
    }

    activeSession = {
        laneId,
        gridResolution,
        constrainHorizontal,
        initialValue: null,
        drawnBeats: new Set(),
        previousPoints: [...lane.points],
        pendingState: null,
        rafId: null,
    };
}

/**
 * Paint a point during an active draw session.
 * Replaces any existing point at the snapped beat.
 */
export function paintDrawPoint(beat: number, value: number): void {
    if (!activeSession) {
        return;
    }

    const snappedBeat = snapToGrid(beat, activeSession.gridResolution);

    // Set initial value for horizontal constrain
    if (activeSession.initialValue === null) {
        activeSession.initialValue = value;
    }

    const paintValue = activeSession.constrainHorizontal ? activeSession.initialValue : value;

    // Read from the latest pending state (if any) or the committed store state.
    // This ensures successive fast paints within the same frame accumulate correctly.
    const state = activeSession.pendingState ?? automationStore.value;
    if (!state) {
        return;
    }

    // Compute the new lane state in memory — do NOT write to the CRDT store yet.
    const nextState: AutomationStoreState = {
        lanes: state.lanes.map((l) => {
            if (l.id !== activeSession!.laneId) {
                return l;
            }
            const filtered = l.points.filter((p) => Math.abs(p.beat - snappedBeat) > 0.001);
            const newPoint: AutomationPoint = {
                beat: snappedBeat,
                value: Math.max(l.minValue, Math.min(l.maxValue, paintValue)),
                curve: 'step',
                tension: 0,
            };
            return { ...l, points: [...filtered, newPoint].sort((a, b) => a.beat - b.beat) };
        }),
    };

    activeSession.pendingState = nextState;
    activeSession.drawnBeats.add(snappedBeat);

    // Schedule a single rAF flush for this frame (idempotent — ignored if already scheduled).
    if (activeSession.rafId === null) {
        activeSession.rafId = requestAnimationFrame(flushPendingState);
    }
}

/**
 * End the draw session and register an undo entry.
 */
export function endDrawSession(): void {
    if (!activeSession) {
        return;
    }

    // Cancel any pending rAF and flush the final accumulated state synchronously.
    if (activeSession.rafId !== null) {
        cancelAnimationFrame(activeSession.rafId);
        activeSession.rafId = null;
    }
    if (activeSession.pendingState !== null) {
        automationStore.set(activeSession.pendingState);
        activeSession.pendingState = null;
    }

    const { laneId, previousPoints } = activeSession;
    const state = automationStore.value;
    const currentLane = state?.lanes.find((l) => l.id === laneId);
    const currentPoints = currentLane ? [...currentLane.points] : [];

    pushUndoEntry(
        'Draw automation',
        () => {
            // Undo: restore previous points
            const s = automationStore.value;
            if (!s) {
                return;
            }
            automationStore.set({
                lanes: s.lanes.map((l) => (l.id === laneId ? { ...l, points: previousPoints } : l)),
            });
        },
        () => {
            // Redo: restore drawn points
            const s = automationStore.value;
            if (!s) {
                return;
            }
            automationStore.set({
                lanes: s.lanes.map((l) => (l.id === laneId ? { ...l, points: currentPoints } : l)),
            });
        }
    );

    activeSession = null;
}

/**
 * Check if a draw session is currently active.
 */
export function isDrawSessionActive(): boolean {
    return activeSession !== null;
}
