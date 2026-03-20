import { type AutomationPoint } from '../models/Automation';
import { automationStore } from '../stores/automationStore';
import { pushUndoEntry } from '#/modules/Command/useCases/pushUndoEntry';

type DrawSession = {
    laneId: string;
    gridResolution: number;
    constrainHorizontal: boolean;
    initialValue: number | null;
    drawnBeats: Set<number>;
    previousPoints: AutomationPoint[];
};

let activeSession: DrawSession | null = null;

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

    const state = automationStore.value;
    if (!state) {
        return;
    }

    // Replace or add point at snapped beat
    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== activeSession!.laneId) {
                return l;
            }
            // Remove any existing point at this beat
            const filtered = l.points.filter((p) => Math.abs(p.beat - snappedBeat) > 0.001);
            // Add the painted point
            const newPoint: AutomationPoint = {
                beat: snappedBeat,
                value: Math.max(l.minValue, Math.min(l.maxValue, paintValue)),
                curve: 'step',
                tension: 0,
            };
            const newPoints = [...filtered, newPoint].sort((a, b) => a.beat - b.beat);
            return { ...l, points: newPoints };
        }),
    });

    activeSession.drawnBeats.add(snappedBeat);
}

/**
 * End the draw session and register an undo entry.
 */
export function endDrawSession(): void {
    if (!activeSession) {
        return;
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
