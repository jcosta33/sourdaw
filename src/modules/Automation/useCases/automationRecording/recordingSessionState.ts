/**
 * Recording session state and internal helpers for automation recording.
 * This state is internal to the recording subsystem — not reusable elsewhere.
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
};

export const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

export const activeRecording = new Map<string, RecordingSession>();
export const pendingPoints = new Map<string, AutomationPoint[]>();
export const touchActive = new Set<string>();

export function makeKey(trackId: string, parameterId: string): string {
    return `${trackId}::${parameterId}`;
}

export function findLaneId(trackId: string, parameterId: string): string | null {
    const state = automationStore.value;
    if (!state) {
        return null;
    }
    const lane = state.lanes.find((l) => l.trackId === trackId && l.parameterId === parameterId);
    return lane?.id ?? null;
}

export function clearPointsInRange(laneId: string, fromBeat: number, toBeat: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== laneId) {
                return l;
            }
            return {
                ...l,
                points: l.points.filter((p) => p.beat < fromBeat || p.beat > toBeat),
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
