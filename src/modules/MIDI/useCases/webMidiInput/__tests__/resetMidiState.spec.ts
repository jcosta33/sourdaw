import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resetMidiState as repoReset } from '../../../repositories/webMidi/lifecycle/resetMidiState';
import { resetMidiState } from '../resetMidiState';

const send_native_live_midi_note = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../../../repositories/webMidi/lifecycle/resetMidiState', () => ({
    resetMidiState: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: { context: { currentTime: 0 }, getTrackStrip: () => undefined },
    sendNativeLiveMidiNote: send_native_live_midi_note,
}));

describe('resetMidiState', () => {
    beforeEach(() => {
        vi.mocked(repoReset).mockClear();
        send_native_live_midi_note.mockClear();
    });

    it('should delegate to the Web MIDI lifecycle repository', () => {
        resetMidiState();

        expect(repoReset).toHaveBeenCalledTimes(1);
    });

    it('gives the repository a native-note release routed through sendNativeLiveMidiNote', () => {
        resetMidiState();

        const input = vi.mocked(repoReset).mock.calls[0]?.[0] as {
            releaseNativeNote: (release: { trackId: string; deviceId: string; note: number; channel: number }) => void;
        };
        input.releaseNativeNote({ trackId: 't', deviceId: 'd', note: 60, channel: 1 });

        expect(send_native_live_midi_note).toHaveBeenCalledWith({
            trackId: 't',
            deviceId: 'd',
            note: 60,
            velocity: 0,
            channel: 1,
            isNoteOn: false,
        });
    });
});
