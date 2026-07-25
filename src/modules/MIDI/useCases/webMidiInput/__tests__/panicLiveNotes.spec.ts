import { beforeEach, describe, expect, it, vi } from 'vitest';

const release_all_active_notes = vi.hoisted(() => vi.fn());
const send_panic_to_midi_outputs = vi.hoisted(() => vi.fn());
const get_track_strip = vi.hoisted(() => vi.fn());

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
}));

const { panicLiveNotes } = await import('../panicLiveNotes');

describe('panicLiveNotes', () => {
    beforeEach(() => {
        release_all_active_notes.mockClear();
        send_panic_to_midi_outputs.mockClear();
        get_track_strip.mockReset();
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

    it('still releases held notes when the outbound broadcast is suppressed', () => {
        // The incoming-CC-120/123 path suppresses the echo so a loopback port
        // cannot bounce the panic back at us forever (audit MD-6).
        panicLiveNotes({ notifyOutputs: false });

        expect(release_all_active_notes).toHaveBeenCalledTimes(1);
        expect(send_panic_to_midi_outputs).not.toHaveBeenCalled();
    });
});
