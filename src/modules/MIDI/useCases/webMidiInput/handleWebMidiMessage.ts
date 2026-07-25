import { logger } from '#/infra/logger/appLogger';

import { parseWebMidiMessage } from '../../repositories/webMidi/messageHandlers';

import { handleWebMidiCC } from './handleWebMidiCC';
import { handleWebMidiChannelPressure } from './handleWebMidiChannelPressure';
import { handleWebMidiNoteOff } from './handleWebMidiNoteOff';
import { handleWebMidiNoteOn } from './handleWebMidiNoteOn';
import { handleWebMidiPitchBend } from './handleWebMidiPitchBend';

/**
 * Serial tail every live MIDI event is dispatched through.
 *
 * Note events can await a Yeast worker round-trip, so they queue. Expression
 * events used to bypass the tail and run synchronously, which inverted their
 * order against the note they belong to: an MPE controller sends the opening
 * bend with the note-on, the bend ran first, found no entry in the
 * channel->note map the note-on had not yet written, and returned early — the
 * note's opening expression was silently dropped (audit MD-3).
 *
 * Everything now goes through here, so arrival order is preserved end to end.
 * When the tail is idle the handler still runs synchronously, so the common
 * case costs nothing.
 */
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

    const timeStamp = message.timeStamp;

    switch (message.type) {
        case 'noteOn':
            dispatchMidiHandler(() => handleWebMidiNoteOn(message.channel, message.note, message.velocity, timeStamp));
            break;
        case 'noteOff':
            dispatchMidiHandler(() =>
                handleWebMidiNoteOff(message.channel, message.note, message.releaseVelocity, timeStamp)
            );
            break;
        case 'cc':
            dispatchMidiHandler(() => handleWebMidiCC(message.channel, message.cc, message.value, timeStamp));
            break;
        case 'channelPressure':
            dispatchMidiHandler(() => handleWebMidiChannelPressure(message.channel, message.pressure, timeStamp));
            break;
        case 'pitchBend':
            dispatchMidiHandler(() => handleWebMidiPitchBend(message.channel, message.lsb, message.msb, timeStamp));
            break;
    }
}
