import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isRecordingAutomation } from '../isRecordingAutomation';
import { isRecordingAutomationByKey } from '../isRecordingAutomationByKey';

type TestTrack = {
    id: string;
    kind: 'audio';
    automationMode: 'read' | 'write' | 'touch' | 'latch';
};

const { activeRecording, touchActive, trackSnapshot } = vi.hoisted(() => {
    const activeRecording = new Map<string, import('../recordingSessionState').RecordingSession>();
    const touchActive = new Set<string>();
    const trackSnapshot: { value: { tracks: TestTrack[] } | null } = { value: null };
    return { activeRecording, touchActive, trackSnapshot };
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

vi.mock('../recordingSessionState', () => ({
    activeRecording,
    touchActive,
}));

function setTracks(tracks: TestTrack[]): void {
    trackSnapshot.value = { tracks };
}

describe('isRecordingAutomation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeRecording.clear();
        touchActive.clear();
        trackSnapshot.value = null;
    });

    it('returns false when there is no active recording session', () => {
        expect(isRecordingAutomation('t1', 'gain')).toBe(false);
    });

    it('returns false when the track no longer exists', () => {
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: null,
        });
        setTracks([]);

        expect(isRecordingAutomation('t1', 'gain')).toBe(false);
    });

    it('returns true in write mode whenever a session exists', () => {
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: null,
        });
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'write' }]);

        expect(isRecordingAutomation('t1', 'gain')).toBe(true);
    });

    it('returns true in touch mode only while touchActive holds the key', () => {
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: null,
        });
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'touch' }]);

        expect(isRecordingAutomation('t1', 'gain')).toBe(false);

        touchActive.add('t1::gain');
        expect(isRecordingAutomation('t1', 'gain')).toBe(true);
    });

    it('returns true in latch mode when touch is active or lastValue is set', () => {
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: null,
        });
        setTracks([{ id: 't1', kind: 'audio', automationMode: 'latch' }]);

        expect(isRecordingAutomation('t1', 'gain')).toBe(false);

        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: 0.5,
        });
        expect(isRecordingAutomation('t1', 'gain')).toBe(true);

        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: null,
        });
        touchActive.add('t1::gain');
        expect(isRecordingAutomation('t1', 'gain')).toBe(true);
    });

    it('queries an already-keyed recording without consulting the track store', () => {
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: null,
        });
        touchActive.add('t1::gain');

        expect(isRecordingAutomationByKey('t1::gain', 'touch')).toBe(true);
    });
});
