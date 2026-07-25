import { describe, it, expect, vi, beforeEach } from 'vitest';

import { startAutomationRecording } from '../startAutomationRecording';

type TestTrack = {
    id: string;
    kind: 'audio';
    automationMode: 'read' | 'write' | 'touch' | 'latch';
};

const { activeRecording, pendingPoints, touchActive, automationSnapshot, trackSnapshot, transportSnapshot } =
    vi.hoisted(() => {
        const activeRecording = new Map<string, import('../recordingSessionState').RecordingSession>();
        const pendingPoints = new Map<string, import('../../../models/Automation').AutomationPoint[]>();
        const touchActive = new Set<string>();
        const automationSnapshot: {
            value: { lanes: Array<import('../../../models/Automation').AutomationLane> } | null;
        } = { value: null };
        const trackSnapshot: { value: { tracks: TestTrack[] } | null } = { value: null };
        const transportSnapshot: { value: { playheadPosition: number } | null } = { value: null };
        return { activeRecording, pendingPoints, touchActive, automationSnapshot, trackSnapshot, transportSnapshot };
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

vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/stores')>();
    return {
        ...actual,
        transportStore: {
            get value() {
                return transportSnapshot.value;
            },
        },
    };
});

vi.mock('../recordingSessionState', () => ({
    RECORDING_MODES: new Set(['write', 'touch', 'latch']),
    activeRecording,
    pendingPoints,
    touchActive,
}));

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return automationSnapshot.value;
        },
    },
}));

function setTracks(tracks: TestTrack[]): void {
    trackSnapshot.value = { tracks };
}

describe('startAutomationRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeRecording.set('stale', {
            parameterId: 'x',
            trackId: 'tx',
            startBeat: 0,
            lastValue: null,
        });
        pendingPoints.set('stale', []);
        touchActive.add('stale');
        automationSnapshot.value = null;
        trackSnapshot.value = null;
        transportSnapshot.value = null;
    });

    it('clears prior recording maps before inspecting tracks', () => {
        startAutomationRecording();

        expect(activeRecording.has('stale')).toBe(false);
        expect(pendingPoints.has('stale')).toBe(false);
        expect(touchActive.has('stale')).toBe(false);
    });

    it('returns early when automation store has no snapshot', () => {
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'write' }]);

        startAutomationRecording();

        expect(activeRecording.size).toBe(0);
    });

    it('seeds sessions for each lane that matches a track in a recording mode', () => {
        automationSnapshot.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        };

        setTracks([
            { id: 't1', kind: 'audio', automationMode: 'write' },
            { id: 't2', kind: 'audio', automationMode: 'read' },
        ]);

        startAutomationRecording();

        expect(activeRecording.get('t1::gain')).toEqual({
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: null,
        });
        expect(pendingPoints.get('t1::gain')).toEqual([]);
        expect(activeRecording.has('t2')).toBe(false);
    });

    // Regression (Batch B fix 1): seeding startBeat at 0 makes latch-mode stop
    // clear [0, lastBeat], wiping pre-existing automation before the record
    // point. The session must anchor at the current playhead instead.
    it('seeds startBeat from the current playhead position, not 0', () => {
        transportSnapshot.value = { playheadPosition: 12 };
        automationSnapshot.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        };
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'latch' }]);

        startAutomationRecording();

        expect(activeRecording.get('t1::gain')?.startBeat).toBe(12);
    });
});
