/**
 * Recording session state and internal helpers for automation recording.
 * This state is internal to the recording subsystem — not reusable elsewhere.
 *
 * The mutable session collections (active sessions, buffered points, touch
 * flags) live behind a get/reset accessor — the same DI-seam shape used by
 * `recordingDependencies` — so a spec can grab the live state and reset it
 * between cases instead of leaking across specs through module-level singletons.
 */

import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';
import { batchAddAutomationPoints } from '../automation/batchAddAutomationPoints';
// Automation-local enum (AGENTS.md §95 — model isolation). Mirrors Arrangement's AutomationMode.
type AutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off';

export type RecordingSession = {
    parameterId: string;
    trackId: string;
    startBeat: number;
    lastValue: number | null;
    /**
     * Tempo (BPM) captured when the session first records a value. Reused for
     * every subsequent value so a mid-session tempo change does not silently
     * re-time the already-recorded beats. Absent/`null` until the first value
     * lands (older sessions seeded before this field omit it entirely).
     */
    tempoAtStart?: number | null;
};

export const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

/** The mutable per-session recording state, grouped so it can be reset as a unit. */
export type RecordingSessionState = {
    /** Active recording sessions keyed by `makeKey(trackId, parameterId)`. */
    activeRecording: Map<string, RecordingSession>;
    /** Points buffered during a session, flushed to the store on release/stop. */
    pendingPoints: Map<string, AutomationPoint[]>;
    /** Keys whose parameter is currently being touched (touch/latch arm). */
    touchActive: Set<string>;
};

function createRecordingSessionState(): RecordingSessionState {
    return {
        activeRecording: new Map<string, RecordingSession>(),
        pendingPoints: new Map<string, AutomationPoint[]>(),
        touchActive: new Set<string>(),
    };
}

let sessionState: RecordingSessionState = createRecordingSessionState();

/** Get the live recording-session state (the DI seam). */
export function getRecordingSessionState(): RecordingSessionState {
    return sessionState;
}

/** Replace the recording-session state wholesale (for tests / explicit reseat). */
export function setRecordingSessionState(state: RecordingSessionState): void {
    sessionState = state;
}

/** Clear every collection in place so no session, buffer, or touch flag leaks. */
export function resetRecordingSessionState(): void {
    sessionState.activeRecording.clear();
    sessionState.pendingPoints.clear();
    sessionState.touchActive.clear();
}

// Named bindings onto the live state. These remain the canonical collections —
// `getRecordingSessionState()` returns the same identity — so they stay valid
// for the lifetime of the (single) session-state holder.
export const activeRecording = sessionState.activeRecording;
export const pendingPoints = sessionState.pendingPoints;
export const touchActive = sessionState.touchActive;

export function makeKey(trackId: string, parameterId: string): string {
    return `${trackId}::${parameterId}`;
}

export function findLaneId(trackId: string, parameterId: string): string | null {
    const state = automationStore.value;
    if (!state) {
        return null;
    }
    const lane = state.lanes.find((length) => length.trackId === trackId && length.parameterId === parameterId);
    return lane?.id ?? null;
}

export function clearPointsInRange(laneId: string, fromBeat: number, toBeat: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((length) => {
            if (length.id !== laneId) {
                return length;
            }
            return {
                ...length,
                points: length.points.filter((param) => param.beat < fromBeat || param.beat > toBeat),
            };
        }),
    });
}

export function flushPendingPoints(key: string): void {
    const points = pendingPoints.get(key);
    const session = activeRecording.get(key);
    if (!points || points.length === 0 || !session) {
        return;
    }

    const laneId = findLaneId(session.trackId, session.parameterId);
    if (!laneId) {
        return;
    }

    batchAddAutomationPoints(laneId, points);
    pendingPoints.set(key, []);
}
