import { describe, it, expect, vi, beforeEach } from 'vitest';

import { admitMidiRecordingEvent } from '../midiRecordingSession';

import { triggerLiveNoteOff } from '../triggerLiveNoteOff';
import { handleWebMidiNoteOff } from '../webMidiInput/handleWebMidiNoteOff';

vi.mock('../webMidiInput/handleWebMidiNoteOff', () => ({
    handleWebMidiNoteOff: vi.fn(),
}));

vi.mock('../midiRecordingSession', () => ({ admitMidiRecordingEvent: vi.fn() }));
vi.mock('../webMidiInput/captureEventBeat', () => ({ captureEventBeatAt: () => 3 }));
vi.mock('../webMidiInput/resolveInputEventTime', () => ({ resolveInputEventTime: () => 2 }));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: { isRecording: true, overdubEnabled: false } },
}));

describe('triggerLiveNoteOff', () => {
    beforeEach(() => {
        vi.mocked(admitMidiRecordingEvent).mockReset();
        vi.mocked(handleWebMidiNoteOff).mockReset();
        vi.mocked(handleWebMidiNoteOff).mockResolvedValue(undefined);
    });

    it('should forward channel and note to the Web MIDI handler, defaulting release velocity to 0', async () => {
        await triggerLiveNoteOff(1, 72);

        expect(handleWebMidiNoteOff).toHaveBeenCalledTimes(1);
        // Callers without a release-velocity get the documented explicit 0 default.
        expect(handleWebMidiNoteOff).toHaveBeenCalledWith(1, 72, 0, {
            audioTime: 2,
            recordingBeat: 3,
            recordingAdmitted: true,
        });
    });

    it('should forward an explicit release velocity to the Web MIDI handler', async () => {
        await triggerLiveNoteOff(1, 72, 0.5);

        expect(handleWebMidiNoteOff).toHaveBeenCalledTimes(1);
        expect(handleWebMidiNoteOff).toHaveBeenCalledWith(1, 72, 0.5, {
            audioTime: 2,
            recordingBeat: 3,
            recordingAdmitted: true,
        });
    });

    it('admits a virtual recording witness before the handler promise settles', async () => {
        const witness = {
            sessionId: 'session-1',
            noteId: 'note-1',
            recordingPassId: 'pass-1',
            trackId: 'track-1',
            clipId: 'clip-1',
            timelineBeat: 3,
            sourceBeat: 7,
            audioTime: 2,
        };
        vi.mocked(admitMidiRecordingEvent).mockReturnValueOnce(witness);
        const pending = triggerLiveNoteOff(1, 72, 0.5);
        expect(handleWebMidiNoteOff).toHaveBeenCalledWith(1, 72, 0.5, {
            audioTime: 2,
            recordingBeat: 3,
            recordingAdmitted: true,
            recordingWitness: witness,
        });
        expect(vi.mocked(admitMidiRecordingEvent).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(handleWebMidiNoteOff).mock.invocationCallOrder[0]!
        );
        await pending;
    });

    it('should return the handler promise so rejections remain observable', async () => {
        const error = new Error('Web MIDI note-off failed');
        vi.mocked(handleWebMidiNoteOff).mockRejectedValueOnce(error);

        await expect(triggerLiveNoteOff(1, 72)).rejects.toBe(error);
    });
});
