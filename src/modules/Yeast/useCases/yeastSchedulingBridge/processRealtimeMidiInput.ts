import { type MidiEvent } from '../../models/MidiEvent';

import { processYeastMidi } from './processYeastMidi';

export function processRealtimeMidiInput(
    note: number,
    velocity: number,
    channel: number,
    isNoteOn: boolean,
    sampleTime: number,
    sampleRate: number,
    blockSize: number = 128
): MidiEvent[] {
    const event: MidiEvent = {
        timeSamples: sampleTime,
        kind: isNoteOn ? { type: 'noteOn', channel, note, velocity } : { type: 'noteOff', channel, note },
    };

    return processYeastMidi([event], sampleTime, sampleTime + blockSize, sampleRate);
}
