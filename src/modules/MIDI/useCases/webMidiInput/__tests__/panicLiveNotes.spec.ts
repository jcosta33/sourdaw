import { beforeEach, describe, expect, it, vi } from 'vitest';

const release_all_active_notes = vi.hoisted(() => vi.fn());
const send_panic_to_midi_outputs = vi.hoisted(() => vi.fn());
const get_track_strip = vi.hoisted(() => vi.fn());
const send_native_live_midi_note = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../../../repositories/webMidi/releaseAllActiveNotes', () => ({
    releaseAllActiveNotes: release_all_active_notes,
}));
vi.mock('../../../repositories/webMidi/sendPanicToMidiOutputs', () => ({
    sendPanicToMidiOutputs: send_panic_to_midi_outputs,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        context: { currentTime: 7 },
        getTrackStrip: get_track_strip,
    },
    sendNativeLiveMidiNote: send_native_live_midi_note,
}));

const { panicLiveNotes } = await import('../panicLiveNotes');

describe('panicLiveNotes', () => {
    beforeEach(() => {
        release_all_active_notes.mockClear();
        send_panic_to_midi_outputs.mockClear();
        get_track_strip.mockReset();
        send_native_live_midi_note.mockClear();
    });

    it('releases held notes against the live audio clock and broadcasts downstream', () => {
        get_track_strip.mockReturnValue({ deviceNodes: [] });

        panicLiveNotes();

        const input = release_all_active_notes.mock.calls[0]?.[0] as {
            getCurrentTime: () => number;
            getTrackStrip: (trackId: string) => unknown;
        };
        expect(input.getCurrentTime()).toBe(7);
        input.getTrackStrip('track-1');
        expect(get_track_strip).toHaveBeenCalledWith('track-1');
        expect(send_panic_to_midi_outputs).toHaveBeenCalledTimes(1);
    });

    it('gives releaseAllActiveNotes a native-note release routed through sendNativeLiveMidiNote', () => {
        get_track_strip.mockReturnValue({ deviceNodes: [] });

        panicLiveNotes();

        const input = release_all_active_notes.mock.calls[0]?.[0] as {
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

    it('still releases held notes when the outbound broadcast is suppressed', () => {
        // The incoming-CC-120/123 path suppresses the echo so a loopback port
        // cannot bounce the panic back at us forever (audit MD-6).
        panicLiveNotes({ notifyOutputs: false });

        expect(release_all_active_notes).toHaveBeenCalledTimes(1);
        expect(send_panic_to_midi_outputs).not.toHaveBeenCalled();
    });
});
