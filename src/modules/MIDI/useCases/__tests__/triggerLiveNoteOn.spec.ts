import { describe, it, expect, vi, beforeEach } from 'vitest';

import { admitMidiRecordingEvent } from '../midiRecordingSession';

import { triggerLiveNoteOn } from '../triggerLiveNoteOn';
import { handleWebMidiNoteOn } from '../webMidiInput/handleWebMidiNoteOn';

vi.mock('../webMidiInput/handleWebMidiNoteOn', () => ({
    handleWebMidiNoteOn: vi.fn(),
}));

vi.mock('../midiRecordingSession', () => ({ admitMidiRecordingEvent: vi.fn() }));
vi.mock('../webMidiInput/captureEventBeat', () => ({ captureEventBeatAt: () => 3 }));
vi.mock('../webMidiInput/resolveInputEventTime', () => ({ resolveInputEventTime: () => 2 }));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: { isRecording: true, overdubEnabled: false } },
}));

describe('triggerLiveNoteOn', () => {
    beforeEach(() => {
        vi.mocked(admitMidiRecordingEvent).mockReset();
        vi.mocked(handleWebMidiNoteOn).mockReset();
        vi.mocked(handleWebMidiNoteOn).mockResolvedValue(undefined);
    });

    it('should forward channel, note, and velocity to the Web MIDI handler', async () => {
        await triggerLiveNoteOn(2, 60, 100);

        expect(handleWebMidiNoteOn).toHaveBeenCalledTimes(1);
        expect(handleWebMidiNoteOn).toHaveBeenCalledWith(2, 60, 100, {
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
        const pending = triggerLiveNoteOn(2, 60, 100);
        expect(handleWebMidiNoteOn).toHaveBeenCalledWith(2, 60, 100, {
            audioTime: 2,
            recordingBeat: 3,
            recordingAdmitted: true,
            recordingWitness: witness,
        });
        expect(vi.mocked(admitMidiRecordingEvent).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(handleWebMidiNoteOn).mock.invocationCallOrder[0]!
        );
        await pending;
    });

    it('should return the handler promise so rejections remain observable', async () => {
        const error = new Error('Web MIDI note-on failed');
        vi.mocked(handleWebMidiNoteOn).mockRejectedValueOnce(error);

        await expect(triggerLiveNoteOn(2, 60, 100)).rejects.toBe(error);
    });
});
