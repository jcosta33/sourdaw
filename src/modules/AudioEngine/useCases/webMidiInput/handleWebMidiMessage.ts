import { parseWebMidiMessage } from '../../repositories/webMidi/messageHandlers';

import { handleWebMidiCC } from './handleWebMidiCC';
import { handleWebMidiChannelPressure } from './handleWebMidiChannelPressure';
import { handleWebMidiNoteOff } from './handleWebMidiNoteOff';
import { handleWebMidiNoteOn } from './handleWebMidiNoteOn';
import { handleWebMidiPitchBend } from './handleWebMidiPitchBend';

export function handleWebMidiMessage(event: MIDIMessageEvent): void {
    const message = parseWebMidiMessage(event);
    if (!message) {
        return;
    }

    switch (message.type) {
        case 'noteOn':
            handleWebMidiNoteOn(message.channel, message.note, message.velocity);
            break;
        case 'noteOff':
            handleWebMidiNoteOff(message.channel, message.note, message.releaseVelocity);
            break;
        case 'cc':
            handleWebMidiCC(message.channel, message.cc, message.value);
            break;
        case 'channelPressure':
            handleWebMidiChannelPressure(message.channel, message.pressure);
            break;
        case 'pitchBend':
            handleWebMidiPitchBend(message.channel, message.lsb, message.msb);
            break;
    }
}
