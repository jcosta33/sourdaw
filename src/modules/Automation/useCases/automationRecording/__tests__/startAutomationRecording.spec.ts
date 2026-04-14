import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startAutomationRecording } from '../startAutomationRecording';

const { activeRecording, pendingPoints, touchActive, automationSnapshot } = vi.hoisted(() => {
    const activeRecording = new Map<
        string,
        import('../../../stores/automationRecordingState').RecordingSession
    >();
    const pendingPoints = new Map<string, import('../../../models/Automation').AutomationPoint[]>();
    const touchActive = new Set<string>();
    const automationSnapshot: {
        value: { lanes: Array<{ trackId: string; parameterId: string }> } | null;
    } = { value: null };
    return { activeRecording, pendingPoints, touchActive, automationSnapshot };
});

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...mod,
        getAllTracks: vi.fn(),
    };
});

vi.mock('../../../stores/automationRecordingState', () => ({
    RECORDING_MODES: new Set(['write', 'touch', 'latch']),
    activeRecording,
    pendingPoints,
    touchActive,
    makeKey: (trackId: string, parameterId: string) => `${trackId}::${parameterId}`,
}));

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return automationSnapshot.value;
        },
    },
}));

import { getAllTracks } from '#/modules/Arrangement/useCases';

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
    });

    it('clears prior recording maps before inspecting tracks', () => {
        startAutomationRecording();

        expect(activeRecording.has('stale')).toBe(false);
        expect(pendingPoints.has('stale')).toBe(false);
        expect(touchActive.has('stale')).toBe(false);
    });

    it('returns early when automation store has no snapshot', () => {
        vi.mocked(getAllTracks).mockReturnValue([
            { id: 't1', kind: 'audio', automationMode: 'write' },
        ] as any);

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
                    virginTerritory: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        };

        vi.mocked(getAllTracks).mockReturnValue([
            { id: 't1', kind: 'audio', automationMode: 'write' },
            { id: 't2', kind: 'audio', automationMode: 'read' },
        ] as any);

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
});
