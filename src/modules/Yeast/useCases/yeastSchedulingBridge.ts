/**
 * Bridge between the Yeast MIDI rack and the DAW's MIDI scheduling pipeline.
 *
 * Called by the transport scheduler to process MIDI notes through the Yeast rack
 * before they're sent to instruments. This handles real-time MIDI input (keyboard/controller)
 * and can also process scheduled clip notes.
 */

import { getYeastRack } from '../stores/yeastStore';
import { transportStore } from '#/modules/Transport';
import { getAudioContext } from '#/modules/AudioEngine';

export type MidiEventKind =
    | { type: 'noteOn'; channel: number; note: number; velocity: number }
    | { type: 'noteOff'; channel: number; note: number }
    | { type: 'cc'; channel: number; cc: number; value: number }
    | { type: 'pitchBend'; channel: number; value: number }
    | { type: 'channelPressure'; channel: number; value: number };

export type MidiEvent = {
    timeSamples: number;
    kind: MidiEventKind;
};

export type TransportInfo = {
    sampleRate: number;
    bpm: number;
    ppqPosition: number;
    isPlaying: boolean;
    barIndex: number;
    beatInBar: number;
    timeSigNum: number;
    timeSigDen: number;
    loopEnabled: boolean;
    loopStartPpq: number;
    loopEndPpq: number;
};

/**
 * Process a batch of MIDI events through the Yeast rack for a specific track.
 * Returns the transformed events.
 */
export function processYeastMidi(
    _trackId: string,
    events: MidiEvent[],
    blockStartSamples: number,
    blockEndSamples: number
): MidiEvent[] {
    const rack = getYeastRack();
    const processorIds = rack.getProcessorIds();

    // If rack is empty, pass through
    if (processorIds.length === 0) return events;

    const transport = transportStore.value;
    if (!transport) return events;

    const transportInfo: TransportInfo = {
        sampleRate: getAudioContext().sampleRate,
        bpm: transport.tempo,
        ppqPosition: 0, // approximate
        isPlaying: transport.isPlaying,
        barIndex: 0,
        beatInBar: 0,
        timeSigNum: transport.timeSignatureNumerator,
        timeSigDen: transport.timeSignatureDenominator,
        loopEnabled: transport.loopStart < transport.loopEnd,
        loopStartPpq: transport.loopStart,
        loopEndPpq: transport.loopEnd,
    };

    return rack.processBlock(events, blockStartSamples, blockEndSamples, transportInfo);
}

/**
 * Convert a real-time MIDI input (from keyboard/controller) into a MidiEvent
 * and process it through the Yeast rack.
 */
export function processRealtimeMidiInput(
    note: number,
    velocity: number,
    channel: number,
    isNoteOn: boolean,
    sampleTime: number
): MidiEvent[] {
    const event: MidiEvent = {
        timeSamples: sampleTime,
        kind: isNoteOn ? { type: 'noteOn', channel, note, velocity } : { type: 'noteOff', channel, note },
    };

    return processYeastMidi('', [event], sampleTime, sampleTime + 128);
}

/**
 * Panic — kill all active notes in the Yeast rack.
 */
export function yeastPanic(sampleTime: number): MidiEvent[] {
    const rack = getYeastRack();
    return rack.allNotesOff(sampleTime);
}
