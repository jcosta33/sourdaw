import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AutomationPoint } from '../../../models/Automation';
import { stopAutomationRecording } from '../stopAutomationRecording';

type TestTrack = {
    id: string;
    kind: 'audio';
    automationMode: 'read' | 'write' | 'touch' | 'latch';
};

type TestLane = {
    id: string;
    trackId: string;
    parameterId: string;
    points: AutomationPoint[];
};

type UndoEntry = { label: string; undo: () => void; redo: () => void };

const {
    activeRecording,
    pendingPoints,
    touchActive,
    laneBaselines,
    findLaneId,
    clearPointsInRange,
    flushPendingPoints,
    trackSnapshot,
    automationSnapshot,
    undoEntries,
} = vi.hoisted(() => {
    const activeRecording = new Map<string, import('../recordingSessionState').RecordingSession>();
    const pendingPoints = new Map<string, import('../../../models/Automation').AutomationPoint[]>();
    const touchActive = new Set<string>();
    const laneBaselines = new Map<string, import('../../../models/Automation').AutomationPoint[]>();
    const trackSnapshot: { value: { tracks: TestTrack[] } | null } = { value: null };
    const automationSnapshot: { value: { lanes: TestLane[] } | null } = { value: null };
    const undoEntries: UndoEntry[] = [];
    return {
        activeRecording,
        pendingPoints,
        touchActive,
        laneBaselines,
        findLaneId: vi.fn(() => null as string | null),
        clearPointsInRange: vi.fn(),
        flushPendingPoints: vi.fn(),
        trackSnapshot,
        automationSnapshot,
        undoEntries,
    };
});

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: {
            get value() {
                return trackSnapshot.value;
            },
        },
    };
});

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        pushUndoEntry: (label: string, undo: () => void, redo: () => void) => {
            undoEntries.push({ label, undo, redo });
        },
    };
});

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return automationSnapshot.value;
        },
        set(value: { lanes: TestLane[] } | null) {
            automationSnapshot.value = value;
        },
    },
}));

vi.mock('../recordingSessionState', () => ({
    activeRecording,
    pendingPoints,
    touchActive,
    laneBaselines,
}));

vi.mock('../findLaneId', () => ({
    findLaneId,
}));

vi.mock('../clearPointsInRange', () => ({
    clearPointsInRange,
}));

vi.mock('../flushPendingPoints', () => ({
    flushPendingPoints,
}));

function setTracks(tracks: TestTrack[]): void {
    trackSnapshot.value = { tracks };
}

describe('stopAutomationRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeRecording.clear();
        pendingPoints.clear();
        touchActive.clear();
        findLaneId.mockReturnValue(null);
        automationSnapshot.value = null;
        undoEntries.length = 0;
        setTracks([]);
    });

    it('handles an empty track snapshot', () => {
        stopAutomationRecording();

        expect(flushPendingPoints).not.toHaveBeenCalled();
    });

    it('flushes each active session then clears all recording maps', () => {
        const session = {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: 0.5 as number | null,
        };
        activeRecording.set('t1::gain', session);
        pendingPoints.set('t1::gain', []);
        touchActive.add('t1::gain');

        stopAutomationRecording();

        expect(flushPendingPoints).toHaveBeenCalledWith('t1::gain');
        expect(activeRecording.size).toBe(0);
        expect(pendingPoints.size).toBe(0);
        expect(touchActive.size).toBe(0);
    });

    it('invokes clearPointsInRange for latch mode when a lane exists and pending points extend the session', () => {
        findLaneId.mockReturnValue('lane-a');
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'latch' }]);

        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 4,
            lastValue: 1,
        });
        pendingPoints.set('t1::gain', [
            { beat: 4, value: 1, curve: 'linear', tension: 0 },
            { beat: 8, value: 0.5, curve: 'linear', tension: 0 },
        ]);

        stopAutomationRecording();

        expect(clearPointsInRange).toHaveBeenCalledWith('lane-a', 4, 8);
        expect(flushPendingPoints).toHaveBeenCalledWith('t1::gain');
    });

    // Regression (Batch B fix 3): write mode also overwrites its recorded span,
    // and that clear must happen once at stop — not per recorded value.
    it('invokes clearPointsInRange once for write mode at stop', () => {
        findLaneId.mockReturnValue('lane-a');
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'write' }]);

        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 2,
            lastValue: 0.9,
        });
        pendingPoints.set('t1::gain', [
            { beat: 2, value: 0.9, curve: 'linear', tension: 0 },
            { beat: 6, value: 0.3, curve: 'linear', tension: 0 },
        ]);

        stopAutomationRecording();

        expect(clearPointsInRange).toHaveBeenCalledTimes(1);
        expect(clearPointsInRange).toHaveBeenCalledWith('lane-a', 2, 6);
    });

    // Regression (Batch B fix 6): the undo must be scoped to the recorded lane.
    // The old whole-store snapshot undo reverted concurrent edits to OTHER lanes.
    it('scopes the undo to the recorded lane and preserves a concurrent edit to another lane', () => {
        findLaneId.mockReturnValue('lane-a');
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'write' }]);

        // lane-a starts empty; the recording flush will add a point to it.
        automationSnapshot.value = {
            lanes: [
                { id: 'lane-a', trackId: 't1', parameterId: 'gain', points: [] },
                { id: 'lane-b', trackId: 't2', parameterId: 'pan', points: [] },
            ],
        };

        // flush mutates the real (mocked) store: lane-a gains the recorded point.
        flushPendingPoints.mockImplementation(() => {
            const state = automationSnapshot.value;
            if (!state) {
                return;
            }
            automationSnapshot.value = {
                lanes: state.lanes.map((lane) =>
                    lane.id === 'lane-a'
                        ? { ...lane, points: [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }] }
                        : lane
                ),
            };
        });

        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: 0.5,
        });
        pendingPoints.set('t1::gain', [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }]);

        stopAutomationRecording();

        expect(undoEntries).toHaveLength(1);

        // A collaborator edits the UNRELATED lane-b after the recording stops.
        const afterStop = automationSnapshot.value;
        expect(afterStop).not.toBeNull();
        automationSnapshot.value = {
            lanes: afterStop.lanes.map((lane) =>
                lane.id === 'lane-b'
                    ? { ...lane, points: [{ beat: 3, value: 0.2, curve: 'linear', tension: 0 }] }
                    : lane
            ),
        };

        // Undoing the recording must revert lane-a only, leaving lane-b's edit intact.
        undoEntries[0]!.undo();

        const afterUndo = automationSnapshot.value;
        const laneA = afterUndo.lanes.find((lane) => lane.id === 'lane-a');
        const laneB = afterUndo.lanes.find((lane) => lane.id === 'lane-b');
        expect(laneA?.points).toEqual([]);
        expect(laneB?.points).toEqual([{ beat: 3, value: 0.2, curve: 'linear', tension: 0 }]);
    });
});
