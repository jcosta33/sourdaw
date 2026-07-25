import { beforeEach, describe, expect, it, vi } from 'vitest';

const handle_note_on = vi.hoisted(() => vi.fn());
const handle_note_off = vi.hoisted(() => vi.fn());
const handle_cc = vi.hoisted(() => vi.fn());
const handle_channel_pressure = vi.hoisted(() => vi.fn());
const handle_pitch_bend = vi.hoisted(() => vi.fn());

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

const { handleWebMidiMessage } = await import('../handleWebMidiMessage');

/** Browser receipt time every event in this suite carries. */
const EVENT_TIME_STAMP = 12_345;

function midi_event(data: number[], timeStamp: number = EVENT_TIME_STAMP): MIDIMessageEvent {
    return { data: new Uint8Array(data), timeStamp } as MIDIMessageEvent;
}

describe('handleWebMidiMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
