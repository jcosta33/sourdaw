import {
    MIDI_CC,
    MIDI_CHANNEL_PRESSURE,
    MIDI_NOTE_OFF,
    MIDI_NOTE_ON,
    MIDI_PITCH_BEND,
} from '../../models/WebMidiTypes';

type ParsedWebMidiMessage =
    | {
          type: 'noteOn';
          channel: number;
          note: number;
          velocity: number;
      }
    | {
          type: 'noteOff';
          channel: number;
          note: number;
          releaseVelocity: number;
      }
    | {
          type: 'cc';
          channel: number;
          cc: number;
          value: number;
      }
    | {
          type: 'channelPressure';
          channel: number;
          pressure: number;
      }
    | {
          type: 'pitchBend';
          channel: number;
          lsb: number;
          msb: number;
      };

export function parseWebMidiMessage(event: MIDIMessageEvent): ParsedWebMidiMessage | null {
    const data = event.data;
    if (!data || data.length < 2) {
        return null;
    }

    const status = data[0]!;
    const messageType = status & 0xf0;
    const channel = status & 0x0f;

    switch (messageType) {
        case MIDI_NOTE_ON:
            return {
                type: 'noteOn',
                channel,
                note: data[1]!,
                velocity: data[2] ?? 0,
            };
        case MIDI_NOTE_OFF:
            return {
                type: 'noteOff',
                channel,
                note: data[1]!,
                releaseVelocity: (data[2] ?? 0) / 127,
            };
        case MIDI_CC:
            return {
                type: 'cc',
                channel,
                cc: data[1]!,
                value: data[2] ?? 0,
            };
        case MIDI_CHANNEL_PRESSURE:
            return {
                type: 'channelPressure',
                channel,
                pressure: data[1]!,
            };
        case MIDI_PITCH_BEND:
            return {
                type: 'pitchBend',
                channel,
                lsb: data[1]!,
                msb: data[2] ?? 0,
            };
        default:
            return null;
    }
}
