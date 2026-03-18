import { getTrackById, getAllTracks } from '../repositories/trackRepository';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { batchAddAutomationPoints } from '#/modules/Track/useCases/automationUseCases';
import { type AutomationPoint } from '#/modules/Track/models/Automation';
import { type AutomationMode } from '#/modules/Track/models/Track';

type RecordingSession = {
    parameterId: string;
    trackId: string;
    startBeat: number;
    lastValue: number | null;
};

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

const activeRecording = new Map<string, RecordingSession>();
const pendingPoints = new Map<string, AutomationPoint[]>();
const touchActive = new Set<string>();

function makeKey(trackId: string, parameterId: string): string {
    return `${trackId}::${parameterId}`;
}

function findLaneId(trackId: string, parameterId: string): string | null {
    const state = automationStore.value;
    if (!state) {
        return null;
    }
    const lane = state.lanes.find((l) => l.trackId === trackId && l.parameterId === parameterId);
    return lane?.id ?? null;
}

function clearPointsInRange(laneId: string, fromBeat: number, toBeat: number): void {
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

function flushPendingPoints(key: string): void {
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

export function startAutomationRecording(): void {
    activeRecording.clear();
    pendingPoints.clear();
    touchActive.clear();

    const tracks = getAllTracks();

    const autoState = automationStore.value;
    if (!autoState) {
        return;
    }

    for (const track of tracks) {
        if (!RECORDING_MODES.has(track.automationMode)) {
            continue;
        }

        for (const lane of autoState.lanes) {
            if (lane.trackId !== track.id) {
                continue;
            }

            const key = makeKey(track.id, lane.parameterId);
            activeRecording.set(key, {
                parameterId: lane.parameterId,
                trackId: track.id,
                startBeat: 0,
                lastValue: null,
            });
            pendingPoints.set(key, []);
        }
    }
}

export function recordAutomationValue(trackId: string, parameterId: string, value: number, beat: number): void {
    const track = getTrackById(trackId);
    if (!track || !RECORDING_MODES.has(track.automationMode)) {
        return;
    }

    const key = makeKey(trackId, parameterId);
    let session = activeRecording.get(key);

    if (!session) {
        session = {
            parameterId,
            trackId,
            startBeat: beat,
            lastValue: null,
        };
        activeRecording.set(key, session);
        pendingPoints.set(key, []);
    }

    const point: AutomationPoint = { beat, value, curve: 'linear', tension: 0 };
    const laneId = findLaneId(trackId, parameterId);

    if (track.automationMode === 'write') {
        if (laneId) {
            clearPointsInRange(laneId, session.startBeat, beat);
        }
        const points = pendingPoints.get(key) ?? [];
        points.push(point);
        pendingPoints.set(key, points);
        session.lastValue = value;
        session.startBeat = beat;
    } else if (track.automationMode === 'touch' || track.automationMode === 'latch') {
        touchActive.add(key);
        const points = pendingPoints.get(key) ?? [];
        points.push(point);
        pendingPoints.set(key, points);
        session.lastValue = value;
    }
}

export function stopAutomationRecording(): void {
    const tracks = getAllTracks();

    for (const [key, session] of activeRecording) {
        const track = tracks.find((t) => t.id === session.trackId);

        if (track?.automationMode === 'latch' && session.lastValue !== null) {
            const points = pendingPoints.get(key) ?? [];
            const lastBeat = points.length > 0 ? points[points.length - 1]!.beat : session.startBeat;
            const laneId = findLaneId(session.trackId, session.parameterId);

            if (laneId && lastBeat > session.startBeat) {
                clearPointsInRange(laneId, session.startBeat, lastBeat);
            }
        }

        flushPendingPoints(key);
    }

    activeRecording.clear();
    pendingPoints.clear();
    touchActive.clear();
}

export function isRecordingAutomation(trackId: string, parameterId: string): boolean {
    const key = makeKey(trackId, parameterId);
    const session = activeRecording.get(key);
    if (!session) {
        return false;
    }

    const track = getTrackById(trackId);
    if (!track) {
        return false;
    }

    if (track.automationMode === 'write') {
        return true;
    }

    if (track.automationMode === 'touch') {
        return touchActive.has(key);
    }

    if (track.automationMode === 'latch') {
        return touchActive.has(key) || session.lastValue !== null;
    }

    return false;
}

export function releaseTouchAutomation(trackId: string, parameterId: string): void {
    const key = makeKey(trackId, parameterId);
    touchActive.delete(key);
    flushPendingPoints(key);
}
