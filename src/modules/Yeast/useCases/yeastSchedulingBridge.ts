import { type MidiEvent, type TransportInfo } from '../models/MidiEvent';
import { getYeastRack } from '../stores/yeastStore';
import { getAudioContext } from '#/modules/AudioEngine/useCases';
import { transportStore } from '#/modules/Transport/stores';

export const processYeastMidiDependencies = {
    getYeastRack,
    transportStore,
    getAudioContext,
} as const;

export function processYeastMidi(
    _trackId: string,
    events: MidiEvent[],
    blockStartSamples: number,
    blockEndSamples: number
): MidiEvent[] {
    const rack = getYeastRack();
    const processorIds = rack.getProcessorIds();

    if (processorIds.length === 0) {
        return events;
    }

    const transport = transportStore.value;
    if (!transport) {
        return events;
    }

    const transportInfo: TransportInfo = {
        sampleRate: getAudioContext().sampleRate,
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
