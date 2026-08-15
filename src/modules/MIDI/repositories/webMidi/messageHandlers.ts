import {
    MIDI_CC,
    MIDI_CHANNEL_PRESSURE,
    MIDI_NOTE_OFF,
    MIDI_NOTE_ON,
    MIDI_PITCH_BEND,
    type WebMidiInputMessage,
} from '../../models/WebMidiTypes';

type ParsedWebMidiMessageBody =
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

type ParsedWebMidiMessage = ParsedWebMidiMessageBody & {
    /**
     * Browser receipt time for this message, a DOMHighResTimeStamp on the
     * `performance.now()` origin. Carried so a handler can place the event at
     * the instant it was played rather than the instant it was processed
     * (audit MD-1). `undefined` when the source supplies no timestamp — the
     * Tauri bridge forwards raw bytes only.
     */
    timeStamp: number | undefined;
};

export function parseWebMidiMessage(event: WebMidiInputMessage): ParsedWebMidiMessage | null {
    const timeStamp = typeof event.timeStamp === 'number' ? event.timeStamp : undefined;
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
                timeStamp,
            };
        case MIDI_NOTE_OFF:
            return {
                type: 'noteOff',
                channel,
                note: data[1]!,
                releaseVelocity: (data[2] ?? 0) / 127,
                timeStamp,
            };
        case MIDI_CC:
            return {
                type: 'cc',
                channel,
                cc: data[1]!,
                value: data[2] ?? 0,
                timeStamp,
            };
        case MIDI_CHANNEL_PRESSURE:
            return {
                type: 'channelPressure',
                channel,
                pressure: data[1]!,
                timeStamp,
            };
        case MIDI_PITCH_BEND:
            return {
                type: 'pitchBend',
                channel,
                lsb: data[1]!,
                msb: data[2] ?? 0,
                timeStamp,
            };
        default:
            return null;
    }
}
