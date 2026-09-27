import { logger } from '#/infra/logger/appLogger';
import { playheadPositionRef } from '#/modules/Transport/stores';

import { createWebMidiNoteKey, type WebMidiInputMessage } from '../../models/WebMidiTypes';
import { memberExpressionGeneration } from '../../repositories/webMidi/memberExpressionGeneration';
import { parseWebMidiMessage } from '../../repositories/webMidi/messageHandlers';
import { activeNotes } from '../../repositories/webMidi/state';

import { handleWebMidiCC } from './handleWebMidiCC';
import { handleWebMidiChannelPressure } from './handleWebMidiChannelPressure';
import { handleWebMidiNoteOff } from './handleWebMidiNoteOff';
import { handleWebMidiNoteOn } from './handleWebMidiNoteOn';
import { handleWebMidiPitchBend } from './handleWebMidiPitchBend';
import { resolveInputEventTime } from './resolveInputEventTime';

/**
 * Serial tail for note events.
 *
 * A note-on can await a Yeast worker round-trip, so note events queue against
 * each other to keep a note-off from overtaking the note-on it releases.
 */
let midiInputTail: Promise<void> | null = null;

/**
 * Most recent still-pending live event per MIDI channel.
 *
 * Expression is ordered against its *own* channel only. It has to wait for a
 * note-on it belongs to — an MPE controller sends the opening bend with the
 * note-on, and running the bend first finds no entry in the channel->note map
 * the note-on has not yet written, so the note's opening expression is
 * silently dropped (audit MD-3).
 *
 * It must not wait for anything else. Serializing expression behind the whole
 * note tail meant an unrelated track's Yeast round-trip could hold a bend for
 * tens of milliseconds; by the time it ran, its arrival frame was behind the
 * render position, so it clamped to "now" and voiced audibly late — worse than
 * the behaviour that predated MD-3's fix. Gating per channel keeps the
 * ordering the finding actually needs and nothing more.
 */
const channelTails = new Map<number, Promise<void>>();
let dispatchGeneration = memberExpressionGeneration.current;

function currentGeneration(): number {
    const generation = memberExpressionGeneration.current;
    if (generation !== dispatchGeneration) {
        // Old, in-flight work may still settle, but a new input/target/MPE
        // session must not wait behind it or inherit its queued gestures.
        midiInputTail = null;
        channelTails.clear();
        dispatchGeneration = generation;
    }
    return generation;
}

function logHandlerFailure(error: unknown): void {
    logger.warn('[MIDI] Web MIDI event handling failed:', error);
}

function trackChannelTail(channel: number, work: Promise<void>): void {
    channelTails.set(channel, work);
    void work.then(() => {
        if (channelTails.get(channel) === work) {
            channelTails.delete(channel);
        }
        return undefined;
    });
}

function admittedRelease(channel: number, note: number): () => boolean {
    const key = createWebMidiNoteKey(channel, note);
    const admittedNote = activeNotes.get(key);
    return () => admittedNote !== undefined && activeNotes.get(key) === admittedNote;
}

function dispatchNoteHandler(
    channel: number,
    handler: () => Promise<void> | void,
    shouldReleaseStale: () => boolean = () => false
): Promise<void> | void {
    const generation = currentGeneration();
    const previous = midiInputTail;
    const channelPrevious = channelTails.get(channel);
    const run = (): Promise<void> | void => {
        if (generation === memberExpressionGeneration.current || shouldReleaseStale()) {
            return handler();
        }
        return undefined;
    };
    // An idle tail runs the handler synchronously up to its first await, so a
    // note is not deferred a turn just to be queued behind nothing.
    let started: Promise<void>;
    try {
        if (previous === null && channelPrevious === undefined) {
            started = Promise.resolve(run());
        } else {
            started = Promise.all([previous, channelPrevious]).then(run);
        }
    } catch (error: unknown) {
        logHandlerFailure(error);
        return undefined;
    }
    const queued = started.catch(logHandlerFailure);
    midiInputTail = queued;
    trackChannelTail(channel, queued);
    void queued.then(() => {
        if (midiInputTail === queued) {
            midiInputTail = null;
        }
        return undefined;
    });
    return queued;
}

function dispatchExpressionHandler(channel: number, handler: () => void): Promise<void> | void {
    const generation = currentGeneration();
    const run = (): void => {
        if (generation === memberExpressionGeneration.current) {
            handler();
        }
    };
    const pending = channelTails.get(channel);
    if (pending === undefined) {
        // Nothing outstanding on this channel: voice it now, at its own
        // arrival frame. This is the common case and it costs nothing.
        try {
            run();
        } catch (error: unknown) {
            logHandlerFailure(error);
        }
        return undefined;
    }

    // Something on this channel is still in flight. Queue behind it, and make
    // this the channel's tail so later expression on the same channel stays in
    // arrival order rather than overtaking it.
    const queued = pending.then(run).catch(logHandlerFailure);
    trackChannelTail(channel, queued);
    return queued;
}

/** Completion of accepted work, when that message had to wait in a queue. */
export function handleWebMidiMessage(event: WebMidiInputMessage): Promise<void> | void {
    const message = parseWebMidiMessage(event);
    if (!message) {
        return undefined;
    }

    const timeStamp = { audioTime: resolveInputEventTime({ timeStamp: message.timeStamp }) };

    const channel = message.channel;

    switch (message.type) {
        case 'noteOn': {
            const admittedTime = { ...timeStamp, recordingBeat: playheadPositionRef.current };
            return dispatchNoteHandler(
                channel,
                () => handleWebMidiNoteOn(channel, message.note, message.velocity, admittedTime),
                message.velocity === 0 ? admittedRelease(channel, message.note) : undefined
            );
        }
        case 'noteOff':
            return dispatchNoteHandler(
                channel,
                async () => {
                    await handleWebMidiNoteOff(channel, message.note, message.releaseVelocity, timeStamp);
                },
                admittedRelease(channel, message.note)
            );
        case 'cc':
            return dispatchExpressionHandler(channel, () => {
                handleWebMidiCC(channel, message.cc, message.value, timeStamp);
            });
        case 'channelPressure':
            return dispatchExpressionHandler(channel, () =>
                handleWebMidiChannelPressure(channel, message.pressure, timeStamp)
            );
        case 'pitchBend':
            return dispatchExpressionHandler(channel, () => {
                handleWebMidiPitchBend(channel, message.lsb, message.msb, timeStamp);
            });
    }
    return undefined;
}
