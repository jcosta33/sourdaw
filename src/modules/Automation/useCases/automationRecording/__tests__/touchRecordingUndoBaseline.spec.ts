import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A released touch pass must still be undoable.
 *
 * `releaseTouchAutomation` flushes the buffered points into the lane the moment
 * the user lets go of the control — mid-session, before the transport is
 * stopped. `stopAutomationRecording` then took its "before" snapshot *at stop*,
 * so those points were already inside it: the diff against the post-flush state
 * came out empty and no "Record Automation" entry was pushed at all. Releasing
 * the control before stopping is the normal touch workflow, so the usual case
 * was an entire recorded performance with no undo behind it.
 *
 * The observable is the lane the user is looking at: record a pass, undo, and
 * the lane holds the points it held before recording. The pre-existing points
 * are seeded away from the recorded values and outside the recorded span, so
 * "restored" cannot be satisfied by an empty lane or by the recorded pass.
 */

type MockTrack = { id: string; automationMode: string };

const { mocks } = vi.hoisted(() => {
    const trackStore: { value: { tracks: MockTrack[] } | null } = { value: null };
    const transportStore: { value: { tempo: number; playheadPosition: number } | null } = { value: null };
    return {
        mocks: {
            trackStore,
            transportStore,
            pushUndoEntry: vi.fn<(label: string, undoFn: () => void, redoFn: () => void) => void>(),
        },
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('#/modules/Transport/stores', () => ({ transportStore: mocks.transportStore }));
vi.mock('#/modules/Command/useCases', () => ({ pushUndoEntry: mocks.pushUndoEntry }));

type SubjectModules = {
    automationStore: typeof import('../../../stores/automationStore').automationStore;
    setAutomationRecordingDependencies: typeof import('../recordingDependencies').setAutomationRecordingDependencies;
    startAutomationRecording: typeof import('../startAutomationRecording').startAutomationRecording;
    recordAutomationValue: typeof import('../recordAutomationValue').recordAutomationValue;
    releaseTouchAutomation: typeof import('../releaseTouchAutomation').releaseTouchAutomation;
    stopAutomationRecording: typeof import('../stopAutomationRecording').stopAutomationRecording;
};

async function loadSubjectModules(): Promise<SubjectModules> {
    vi.resetModules();
    const { automationStore } = await import('../../../stores/automationStore');
    const { setAutomationRecordingDependencies } = await import('../recordingDependencies');
    const { startAutomationRecording } = await import('../startAutomationRecording');
    const { recordAutomationValue } = await import('../recordAutomationValue');
    const { releaseTouchAutomation } = await import('../releaseTouchAutomation');
    const { stopAutomationRecording } = await import('../stopAutomationRecording');
    setAutomationRecordingDependencies({
        // Zero latency: this spec is about which snapshot the undo entry holds,
        // and a non-zero compensation would shift every recorded beat.
        getAudioContext: () => ({ baseLatency: 0, outputLatency: 0 }) as unknown as AudioContext,
        getCompensationDelay: () => 0,
    });
    return {
        automationStore,
        setAutomationRecordingDependencies,
        startAutomationRecording,
        recordAutomationValue,
        releaseTouchAutomation,
        stopAutomationRecording,
    };
}

const LANE_ID = 'lane-cutoff';
const TRACK_ID = 't1';
const PARAMETER_ID = 'cutoff';

/**
 * Seeded outside the recorded span (beats 4–6) and away from the recorded value
 * (0.9), so a restore cannot be confused with an empty lane or with the pass.
 */
const PRE_EXISTING = [
    { beat: 0, value: 0.1, curve: 'linear' as const, tension: 0 },
    { beat: 32, value: 0.2, curve: 'linear' as const, tension: 0 },
];

function seedLane(automationStore: SubjectModules['automationStore']): void {
    automationStore.set({
        lanes: [
            {
                id: LANE_ID,
                trackId: TRACK_ID,
                parameterId: PARAMETER_ID,
                points: PRE_EXISTING.map((point) => ({ ...point })),
                visible: true,
                minValue: 0,
                maxValue: 1,
                enabled: true,
                clipId: null,
                linkedLaneId: null,
                objects: [],
                trimPoints: [],
                ghostPoints: [],
                clipAutomationMode: 'additive',
            },
        ],
    });
}

function lanePoints(automationStore: SubjectModules['automationStore']): Array<{ beat: number; value: number }> {
    const lane = automationStore.value?.lanes.find((candidate) => candidate.id === LANE_ID);
    return (lane?.points ?? []).map((point) => ({ beat: point.beat, value: point.value }));
}

describe('undoing a touch automation pass released before stop', () => {
    beforeEach(() => {
        mocks.pushUndoEntry.mockReset();
        mocks.trackStore.value = { tracks: [{ id: TRACK_ID, automationMode: 'touch' }] };
        mocks.transportStore.value = { tempo: 120, playheadPosition: 0 };
    });

    it('restores the lane the pass overwrote', async () => {
        const subject = await loadSubjectModules();
        seedLane(subject.automationStore);

        subject.startAutomationRecording();
        subject.recordAutomationValue(TRACK_ID, PARAMETER_ID, 0.9, 4);
        subject.recordAutomationValue(TRACK_ID, PARAMETER_ID, 0.95, 5);
        subject.recordAutomationValue(TRACK_ID, PARAMETER_ID, 0.9, 6);
        // The touch release flushes mid-session — this is the write the stop-time
        // snapshot could not see.
        subject.releaseTouchAutomation(TRACK_ID, PARAMETER_ID);

        expect(lanePoints(subject.automationStore).length).toBeGreaterThan(PRE_EXISTING.length);

        subject.stopAutomationRecording();

        expect(mocks.pushUndoEntry).toHaveBeenCalledOnce();
        const [label, undoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        expect(label).toBe('Record Automation');

        undoFn();

        expect(lanePoints(subject.automationStore)).toEqual([
            { beat: 0, value: 0.1 },
            { beat: 32, value: 0.2 },
        ]);
    });

    it('redo puts the released pass back', async () => {
        const subject = await loadSubjectModules();
        seedLane(subject.automationStore);

        subject.startAutomationRecording();
        subject.recordAutomationValue(TRACK_ID, PARAMETER_ID, 0.9, 4);
        subject.recordAutomationValue(TRACK_ID, PARAMETER_ID, 0.95, 5);
        subject.recordAutomationValue(TRACK_ID, PARAMETER_ID, 0.9, 6);
        subject.releaseTouchAutomation(TRACK_ID, PARAMETER_ID);
        subject.stopAutomationRecording();

        const recorded = lanePoints(subject.automationStore);
        const [, undoFn, redoFn] = mocks.pushUndoEntry.mock.calls[0]!;

        undoFn();
        redoFn();

        expect(lanePoints(subject.automationStore)).toEqual(recorded);
    });

    it('a pass still held at stop is undone too, and only one entry covers both', async () => {
        const subject = await loadSubjectModules();
        seedLane(subject.automationStore);

        subject.startAutomationRecording();
        subject.recordAutomationValue(TRACK_ID, PARAMETER_ID, 0.9, 4);
        subject.recordAutomationValue(TRACK_ID, PARAMETER_ID, 0.9, 6);
        subject.releaseTouchAutomation(TRACK_ID, PARAMETER_ID);
        // Second gesture on the same parameter, never released before stop.
        subject.recordAutomationValue(TRACK_ID, PARAMETER_ID, 0.4, 12);
        subject.recordAutomationValue(TRACK_ID, PARAMETER_ID, 0.4, 14);

        subject.stopAutomationRecording();

        expect(mocks.pushUndoEntry).toHaveBeenCalledOnce();
        const [, undoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        undoFn();

        expect(lanePoints(subject.automationStore)).toEqual([
            { beat: 0, value: 0.1 },
            { beat: 32, value: 0.2 },
        ]);
    });

    // --- negative: an entry must be caused by a real edit, not by stopping ---

    it('pushes no undo entry when the session recorded nothing', async () => {
        const subject = await loadSubjectModules();
        seedLane(subject.automationStore);

        subject.startAutomationRecording();
        subject.releaseTouchAutomation(TRACK_ID, PARAMETER_ID);
        subject.stopAutomationRecording();

        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(lanePoints(subject.automationStore)).toEqual([
            { beat: 0, value: 0.1 },
            { beat: 32, value: 0.2 },
        ]);
    });
});
