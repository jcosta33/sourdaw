import { logger } from '#/infra/logger/appLogger';

import { parseWebMidiMessage } from '../../repositories/webMidi/messageHandlers';

import { handleWebMidiCC } from './handleWebMidiCC';
import { handleWebMidiChannelPressure } from './handleWebMidiChannelPressure';
import { handleWebMidiNoteOff } from './handleWebMidiNoteOff';
import { handleWebMidiNoteOn } from './handleWebMidiNoteOn';
import { handleWebMidiPitchBend } from './handleWebMidiPitchBend';

let midiInputTail: Promise<void> | null = null;

function dispatchMidiHandler(handler: () => void | Promise<void>): void {
    if (midiInputTail) {
        const queued = midiInputTail
            .then(() => handler())
            .catch((error: unknown) => {
                logger.warn('[MIDI] Web MIDI event handling failed:', error);
            });
        midiInputTail = queued;
        void queued.then(() => {
            if (midiInputTail === queued) {
                midiInputTail = null;
            }
            return undefined;
        });
        return;
    }

    const result = handler();
    if (result === undefined) {
        return;
    }

    const pending = result.catch((error: unknown) => {
        logger.warn('[MIDI] Web MIDI event handling failed:', error);
    });
    midiInputTail = pending;
    void pending.then(() => {
        if (midiInputTail === pending) {
            midiInputTail = null;
        }
        return undefined;
    });
}

export function handleWebMidiMessage(event: MIDIMessageEvent): void {
    const message = parseWebMidiMessage(event);
    if (!message) {
        return;
    }

    switch (message.type) {
        case 'noteOn':
            dispatchMidiHandler(() => handleWebMidiNoteOn(message.channel, message.note, message.velocity));
            break;
        case 'noteOff':
            dispatchMidiHandler(() => handleWebMidiNoteOff(message.channel, message.note, message.releaseVelocity));
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
