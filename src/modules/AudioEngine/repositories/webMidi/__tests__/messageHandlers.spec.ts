import { describe, expect, it } from 'vitest';

import { parseWebMidiMessage } from '../messageHandlers';

function midi_event(data: number[]): MIDIMessageEvent {
    return { data: new Uint8Array(data) } as MIDIMessageEvent;
}

describe('parseWebMidiMessage', () => {
    it('should parse note-on bytes', () => {
        expect(parseWebMidiMessage(midi_event([0x92, 60, 100]))).toEqual({
            type: 'noteOn',
            channel: 2,
            note: 60,
            velocity: 100,
        });
    });

    it('should normalize note-off release velocity', () => {
        expect(parseWebMidiMessage(midi_event([0x81, 72, 96]))).toEqual({
            type: 'noteOff',
            channel: 1,
            note: 72,
            releaseVelocity: 96 / 127,
        });
    });

    it('should parse controller, pressure, and pitch-bend messages', () => {
        expect(parseWebMidiMessage(midi_event([0xb3, 7, 101]))).toEqual({
            type: 'cc',
            channel: 3,
            cc: 7,
            value: 101,
        });
        expect(parseWebMidiMessage(midi_event([0xd4, 87]))).toEqual({
            type: 'channelPressure',
            channel: 4,
            pressure: 87,
        });
        expect(parseWebMidiMessage(midi_event([0xe5, 0, 65]))).toEqual({
            type: 'pitchBend',
            channel: 5,
            lsb: 0,
            msb: 65,
        });
    });

    it('should ignore empty, one-byte, and unhandled messages', () => {
        expect(parseWebMidiMessage(midi_event([]))).toBeNull();
        expect(parseWebMidiMessage(midi_event([0x90]))).toBeNull();
        expect(parseWebMidiMessage(midi_event([0xf8, 0]))).toBeNull();
    });
});
