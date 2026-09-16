import { beforeEach, describe, expect, it, vi } from 'vitest';

const release_all_active_notes = vi.hoisted(() => vi.fn());
const send_panic_to_midi_outputs = vi.hoisted(() => vi.fn());
const get_track_strip = vi.hoisted(() => vi.fn());
const send_native_live_midi_note = vi.hoisted(() => vi.fn(async () => true));
const send_native_live_midi_control = vi.hoisted(() => vi.fn(async () => true));
const grand_boule_controls = vi.hoisted(() => {
    const calls: string[] = [];
    return {
        calls,
        ready: true,
        allNotesOff: vi.fn(() => void calls.push('allNotesOff')),
        setSustain: vi.fn((position: number) => void calls.push(`setSustain ${position}`)),
        setSostenuto: vi.fn((engaged: boolean) => void calls.push(`setSostenuto ${engaged}`)),
        setUnaCorda: vi.fn((engaged: boolean) => void calls.push(`setUnaCorda ${engaged}`)),
    };
});
const is_device_held_by_native_session = vi.hoisted(() =>
    vi.fn<(trackId: string, deviceId: string) => boolean>(() => false)
);
const track_store = vi.hoisted(() => ({ value: null as { tracks: unknown[] } | null }));

vi.mock('../../../repositories/webMidi/releaseAllActiveNotes', () => ({
    releaseAllActiveNotes: release_all_active_notes,
}));
vi.mock('../../../repositories/webMidi/sendPanicToMidiOutputs', () => ({
    sendPanicToMidiOutputs: send_panic_to_midi_outputs,
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: track_store,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        context: { currentTime: 7 },
        getTrackStrip: get_track_strip,
    },
    isDeviceHeldByNativeSession: is_device_held_by_native_session,
    sendNativeLiveMidiControl: send_native_live_midi_control,
    sendNativeLiveMidiNote: send_native_live_midi_note,
}));

const { panicLiveNotes } = await import('../panicLiveNotes');

/** All Sound Off and Reset All Controllers, spelled as the wire literals. */
const CC_ALL_SOUND_OFF = 120;
const CC_RESET_ALL_CONTROLLERS = 121;

/** One track carrying one Grand Boule, plus a device that is not one. */
const grand_boule_tracks = () => ({
    tracks: [
        {
            id: 'track-1',
            devices: [
                { id: 'gluten-1', type: 'gluten' },
                { id: 'gb-1', type: 'grand-boule' },
            ],
        },
    ],
});

/** The strip the mocked engine hands back for that track. */
const grand_boule_strip = () => ({
    deviceNodes: [
        { deviceId: 'gluten-1', type: 'gluten' },
        { deviceId: 'gb-1', type: 'grand-boule', grandBouleControls: grand_boule_controls },
    ],
});

describe('panicLiveNotes', () => {
    beforeEach(() => {
        release_all_active_notes.mockClear();
        send_panic_to_midi_outputs.mockClear();
        get_track_strip.mockReset();
        send_native_live_midi_note.mockClear();
        send_native_live_midi_control.mockClear();
        grand_boule_controls.calls.length = 0;
        grand_boule_controls.ready = true;
        grand_boule_controls.allNotesOff.mockClear();
        grand_boule_controls.setSustain.mockClear();
        grand_boule_controls.setSostenuto.mockClear();
        grand_boule_controls.setUnaCorda.mockClear();
        is_device_held_by_native_session.mockReset();
        is_device_held_by_native_session.mockReturnValue(false);
        track_store.value = null;
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

    it('sends every held Grand Boule body All Sound Off and then Reset All Controllers', () => {
        // Note-offs alone leave a damper-held voice ringing: the engine's body
        // routes a note-off to release_key while the pedal is down, so a panic
        // needs the two channel-mode messages to reach silence and lift the
        // pedal behind it. Reset All Controllers is also what discharges the
        // renderer's memory of that pedal, so the body the next play builds does
        // not come up standing on it — `liveMidiControlLatch.ts` owns that half,
        // and its own spec pins it.
        track_store.value = grand_boule_tracks();
        is_device_held_by_native_session.mockImplementation(
            (trackId: string, deviceId: string) => trackId === 'track-1' && deviceId === 'gb-1'
        );

        panicLiveNotes();

        expect(send_native_live_midi_control).toHaveBeenCalledTimes(2);
        expect(send_native_live_midi_control).toHaveBeenNthCalledWith(1, {
            trackId: 'track-1',
            deviceId: 'gb-1',
            controller: CC_ALL_SOUND_OFF,
            value: 0,
            channel: 0,
        });
        expect(send_native_live_midi_control).toHaveBeenNthCalledWith(2, {
            trackId: 'track-1',
            deviceId: 'gb-1',
            controller: CC_RESET_ALL_CONTROLLERS,
            value: 0,
            channel: 0,
        });
    });

    it('sends nothing natively when the engine holds no Grand Boule body', () => {
        track_store.value = grand_boule_tracks();
        is_device_held_by_native_session.mockReturnValue(false);

        panicLiveNotes();

        expect(send_native_live_midi_control).not.toHaveBeenCalled();
    });

    it('sends the native sequence even with the outbound broadcast suppressed', () => {
        // An incoming CC 120 or 123 from the controller routes here with the
        // echo off, and that is exactly the panic a player reaches for when a
        // pedalled note hangs.
        track_store.value = grand_boule_tracks();
        is_device_held_by_native_session.mockImplementation(
            (trackId: string, deviceId: string) => trackId === 'track-1' && deviceId === 'gb-1'
        );

        panicLiveNotes({ notifyOutputs: false });

        expect(send_panic_to_midi_outputs).not.toHaveBeenCalled();
        expect(send_native_live_midi_control).toHaveBeenCalledTimes(2);
    });

    it('kills the Web Audio piano and then raises its three pedals, in that order', () => {
        // The same reason the engine's body needs the channel-mode pair: a
        // note-off under a held damper releases the key instead of damping it.
        // Raising a pedal before the kill would let the strings ring out rather
        // than stop, so the order is the behaviour, not an incidental.
        track_store.value = grand_boule_tracks();
        get_track_strip.mockReturnValue(grand_boule_strip());

        panicLiveNotes();

        expect(grand_boule_controls.calls).toEqual([
            'allNotesOff',
            'setSustain 0',
            'setSostenuto false',
            'setUnaCorda false',
        ]);
    });

    it('sends the Web Audio piano nothing while its node is not ready', () => {
        // Nothing has a worklet to receive any of this yet, and nothing is
        // sounding on it to silence.
        track_store.value = grand_boule_tracks();
        grand_boule_controls.ready = false;
        get_track_strip.mockReturnValue(grand_boule_strip());

        panicLiveNotes();

        expect(grand_boule_controls.calls).toEqual([]);
    });
});
