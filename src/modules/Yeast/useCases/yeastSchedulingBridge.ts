/**
 * Bridge between the Yeast MIDI rack and the DAW's MIDI scheduling pipeline.
 *
 * Called by the transport scheduler to process MIDI notes through the Yeast rack
 * before they're sent to instruments. This handles real-time MIDI input (keyboard/controller)
 * and can also process scheduled clip notes.
 */

import { inject } from '#/infra/di/inject';
import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';
import { getYeastRack } from '../stores/yeastStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';

export const processYeastMidiDependencies = {
    getYeastRack,
    transportStore,
    getAudioContext,
} as const;

/**
 * Process a batch of MIDI events through the Yeast rack for a specific track.
 * Returns the transformed events.
 */
export const processYeastMidi = inject(processYeastMidiDependencies)(
    ({ getYeastRack: getYeastRackFn, transportStore: transportStoreDep, getAudioContext: getAudioContextFn }) =>
        function processYeastMidi(
            _trackId: string,
            events: MidiEvent[],
            blockStartSamples: number,
            blockEndSamples: number
        ): MidiEvent[] {
            const rack = getYeastRackFn();
            const processorIds = rack.getProcessorIds();

            if (processorIds.length === 0) {
                return events;
            }

            const transport = transportStoreDep.value;
            if (!transport) {
                return events;
            }

            const transportInfo: TransportInfo = {
                sampleRate: getAudioContextFn().sampleRate,
                bpm: transport.tempo,
                ppqPosition: 0,
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
);

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

export function yeastPanic(sampleTime: number): MidiEvent[] {
    const rack = getYeastRack();
    return rack.allNotesOff(sampleTime);
}
