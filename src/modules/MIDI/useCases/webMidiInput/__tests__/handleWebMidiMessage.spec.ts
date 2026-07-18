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

function midi_event(data: number[]): MIDIMessageEvent {
    return { data: new Uint8Array(data) } as MIDIMessageEvent;
}

describe('handleWebMidiMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should dispatch CC bytes to the CC use case', () => {
        handleWebMidiMessage(midi_event([0xb3, 7, 101]));

        expect(handle_cc).toHaveBeenCalledWith(3, 7, 101);
    });

    it('should normalize raw note-off release velocity before dispatch', () => {
        handleWebMidiMessage(midi_event([0x81, 72, 96]));

        expect(handle_note_off).toHaveBeenCalledWith(1, 72, 96 / 127);
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

        expect(handle_note_off).toHaveBeenCalledWith(0, 60, 0);
    });
});
