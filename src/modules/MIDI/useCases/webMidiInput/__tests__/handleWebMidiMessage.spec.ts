import { beforeEach, describe, expect, it, vi } from 'vitest';

const handle_note_on = vi.hoisted(() => vi.fn());
const handle_note_off = vi.hoisted(() => vi.fn());
const handle_cc = vi.hoisted(() => vi.fn());
const handle_channel_pressure = vi.hoisted(() => vi.fn());
const handle_pitch_bend = vi.hoisted(() => vi.fn());
const audio_clock = vi.hoisted(() => ({ currentTime: 2, sampleRate: 48000 }));

vi.mock('../handleWebMidiNoteOn', () => ({
    handleWebMidiNoteOn: handle_note_on,
}));

vi.mock('../handleWebMidiNoteOff', () => ({
    handleWebMidiNoteOff: handle_note_off,
}));

vi.mock('../handleWebMidiCC', () => ({
    handleWebMidiCC: handle_cc,
}));

vi.mock('../handleWebMidiChannelPressure', () => ({
    handleWebMidiChannelPressure: handle_channel_pressure,
}));

vi.mock('../handleWebMidiPitchBend', () => ({
    handleWebMidiPitchBend: handle_pitch_bend,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: { context: audio_clock },
}));

const { handleWebMidiMessage } = await import('../handleWebMidiMessage');
const { resolveInputEventTime } = await import('../resolveInputEventTime');
const { resolveInputDispatchFrame } = await import('../resolveInputDispatchFrame');

/** Browser receipt time every event in this suite carries. */
const EVENT_TIME_STAMP = 12_345;

function midi_event(data: number[], timeStamp: number = EVENT_TIME_STAMP): MIDIMessageEvent {
    return { data: new Uint8Array(data), timeStamp } as MIDIMessageEvent;
}

describe('handleWebMidiMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        audio_clock.currentTime = 2;
    });

    it('should dispatch CC bytes to the CC use case', () => {
        handleWebMidiMessage(midi_event([0xb3, 7, 101]));

        // The browser's receipt time rides along to every handler so the event
        // can be placed when it was played, not when it was processed (MD-1).
        expect(handle_cc).toHaveBeenCalledWith(3, 7, 101, EVENT_TIME_STAMP);
    });

    it('should normalize raw note-off release velocity before dispatch', () => {
        handleWebMidiMessage(midi_event([0x81, 72, 96]));

        expect(handle_note_off).toHaveBeenCalledWith(1, 72, 96 / 127, EVENT_TIME_STAMP);
    });

    it('should ignore short or empty browser MIDI events', () => {
        handleWebMidiMessage(midi_event([]));
        handleWebMidiMessage(midi_event([0x90]));

        expect(handle_note_on).not.toHaveBeenCalled();
        expect(handle_note_off).not.toHaveBeenCalled();
        expect(handle_cc).not.toHaveBeenCalled();
        expect(handle_channel_pressure).not.toHaveBeenCalled();
        expect(handle_pitch_bend).not.toHaveBeenCalled();
    });

    it('should serialize note events while a Yeast runtime request is pending', async () => {
        let resolveNoteOn!: () => void;
        const noteOnPending = new Promise<void>((resolve) => {
            resolveNoteOn = resolve;
        });
        handle_note_on.mockImplementationOnce(() => noteOnPending);

        handleWebMidiMessage(midi_event([0x90, 60, 100]));
        handleWebMidiMessage(midi_event([0x80, 60, 0]));

        expect(handle_note_on).toHaveBeenCalledTimes(1);
        expect(handle_note_off).not.toHaveBeenCalled();

        resolveNoteOn();
        await noteOnPending;
        await Promise.resolve();

        expect(handle_note_off).toHaveBeenCalledWith(0, 60, 0, EVENT_TIME_STAMP);
    });

    it('should hold a pitch bend behind a pending note-on so the opening bend is not dropped', async () => {
        let resolveNoteOn!: () => void;
        const noteOnPending = new Promise<void>((resolve) => {
            resolveNoteOn = resolve;
        });
        const order: string[] = [];
        handle_note_on.mockImplementationOnce(() => {
            order.push('noteOn');
            return noteOnPending;
        });
        handle_pitch_bend.mockImplementation(() => {
            order.push('pitchBend');
        });

        // An MPE controller sends the member-channel bend together with the
        // note-on. The note-on is queued behind the async tail, so the bend has
        // to queue behind it too — run first it resolves against a
        // channel->note map the note-on has not written yet, returns early, and
        // the note's opening bend is lost (audit MD-3).
        handleWebMidiMessage(midi_event([0x91, 60, 100]));
        handleWebMidiMessage(midi_event([0xe1, 0, 96]));

        expect(order).toEqual(['noteOn']);

        resolveNoteOn();
        await noteOnPending;
        await Promise.resolve();
        await Promise.resolve();

        expect(order).toEqual(['noteOn', 'pitchBend']);
    });

    it('should hold channel pressure and CC behind a pending note-on, in arrival order', async () => {
        let resolveNoteOn!: () => void;
        const noteOnPending = new Promise<void>((resolve) => {
            resolveNoteOn = resolve;
        });
        const order: string[] = [];
        handle_note_on.mockImplementationOnce(() => {
            order.push('noteOn');
            return noteOnPending;
        });
        handle_channel_pressure.mockImplementation(() => {
            order.push('channelPressure');
        });
        handle_cc.mockImplementation(() => {
            order.push('cc');
        });

        handleWebMidiMessage(midi_event([0x91, 60, 100]));
        handleWebMidiMessage(midi_event([0xd1, 90]));
        handleWebMidiMessage(midi_event([0xb1, 74, 40]));

        expect(order).toEqual(['noteOn']);

        resolveNoteOn();
        await noteOnPending;
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(order).toEqual(['noteOn', 'channelPressure', 'cc']);
    });

    it('should not delay expression past its arrival frame behind an unrelated note-on', async () => {
        let resolveNoteOn!: () => void;
        const noteOnPending = new Promise<void>((resolve) => {
            resolveNoteOn = resolve;
        });
        handle_note_on.mockImplementationOnce(() => noteOnPending);

        // The bend records the frame it would voice at, resolved exactly the
        // way the real pitch-bend handler resolves it.
        let bendFrame: number | null = null;
        handle_pitch_bend.mockImplementation((_channel: number, _lsb: number, _msb: number, timeStamp?: number) => {
            bendFrame = resolveInputDispatchFrame({ eventTime: resolveInputEventTime({ timeStamp }) });
        });

        const performance_now = vi.spyOn(performance, 'now');

        // A note-on on channel 1 lands on a Yeast-equipped track and stalls in
        // its cross-thread worker round trip.
        audio_clock.currentTime = 2;
        performance_now.mockReturnValue(1000);
        handleWebMidiMessage(midi_event([0x91, 60, 100], 1000));

        // 50 ms later an unrelated channel-2 bend arrives. It owes nothing to
        // the stalled note, so it must voice at its own arrival frame rather
        // than waiting and being clamped forward to a later render position.
        audio_clock.currentTime = 2.05;
        performance_now.mockReturnValue(1050);
        handleWebMidiMessage(midi_event([0xe2, 0, 96], 1050));

        // 2.05 s at 48 kHz, plus the one-quantum scheduling budget.
        expect(bendFrame).toBe(98_528);

        // Draining the note-on must not retroactively move it.
        audio_clock.currentTime = 2.1;
        performance_now.mockReturnValue(1100);
        resolveNoteOn();
        await noteOnPending;
        await Promise.resolve();
        await Promise.resolve();

        expect(bendFrame).toBe(98_528);

        performance_now.mockRestore();
    });
});
