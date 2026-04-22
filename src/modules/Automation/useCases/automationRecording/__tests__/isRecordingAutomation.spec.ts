import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isRecordingAutomation } from '../isRecordingAutomation';

import type { Track } from '#/modules/Arrangement/models/Track';

const { activeRecording, touchActive, getTrackByIdMock } = vi.hoisted(() => {
    const activeRecording = new Map<string, import('../recordingSessionState').RecordingSession>();
    const touchActive = new Set<string>();
    const getTrackByIdMock = vi.fn<(id: string) => import('#/modules/Arrangement/models/Track').Track | undefined>();
    return { activeRecording, touchActive, getTrackByIdMock };
});

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...mod,
        getTrackById: getTrackByIdMock,
    };
});

vi.mock('../recordingSessionState', () => ({
    activeRecording,
    touchActive,
    makeKey: (trackId: string, parameterId: string) => `${trackId}::${parameterId}`,
}));

describe('isRecordingAutomation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeRecording.clear();
        touchActive.clear();
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
        getTrackByIdMock.mockReturnValue(undefined);

        expect(isRecordingAutomation('t1', 'gain')).toBe(false);
    });

    it('returns true in write mode whenever a session exists', () => {
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: null,
        });
        getTrackByIdMock.mockReturnValue({
            id: 't1',
            kind: 'audio',
            automationMode: 'write',
        } as Track);

        expect(isRecordingAutomation('t1', 'gain')).toBe(true);
    });

    it('returns true in touch mode only while touchActive holds the key', () => {
        activeRecording.set('t1::gain', {
            parameterId: 'gain',
            trackId: 't1',
            startBeat: 0,
            lastValue: null,
        });
        getTrackByIdMock.mockReturnValue({
            id: 't1',
            kind: 'audio',
            automationMode: 'touch',
        } as Track);

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
        getTrackByIdMock.mockReturnValue({
            id: 't1',
            kind: 'audio',
            automationMode: 'latch',
        } as Track);

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
});
