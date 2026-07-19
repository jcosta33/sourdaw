import { transportStore } from '#/modules/Transport/stores';

import { processYeastMidi } from './processYeastMidi';

import type { MidiEvent, TransportInfo } from '../../models/MidiEvent';

type ProcessRealtimeMidiInputInput = {
    context: BaseAudioContext;
    rackId: string;
    routeId?: string;
    trackId: string;
    note: number;
    velocity: number;
    channel: number;
    isNoteOn: boolean;
    sampleTime: number;
    sampleRate: number;
    blockSize?: number;
};

export function processRealtimeMidiInput(input: ProcessRealtimeMidiInputInput): Promise<MidiEvent[]> {
    const event: MidiEvent = {
        timeSamples: input.sampleTime,
        trackId: input.trackId,
        kind: input.isNoteOn
            ? { type: 'noteOn', channel: input.channel, note: input.note, velocity: input.velocity }
            : { type: 'noteOff', channel: input.channel, note: input.note },
    };

    const transport = transportStore.value;
    if (!transport) {
        return Promise.resolve([event]);
    }

    const transportInfo: TransportInfo = {
        sampleRate: input.sampleRate,
        bpm: transport.tempo,
        ppqPosition: transport.playheadPosition,
        isPlaying: transport.isPlaying,
        barIndex: 0,
        beatInBar: 0,
        timeSigNum: transport.timeSignatureNumerator,
        timeSigDen: transport.timeSignatureDenominator,
        loopEnabled: transport.loopStart < transport.loopEnd,
        loopStartPpq: transport.loopStart,
        loopEndPpq: transport.loopEnd,
    };

    return processYeastMidi({
        context: input.context,
        rackId: input.rackId,
        routeId: input.routeId ?? input.trackId,
        trackId: input.trackId,
        events: [event],
        blockStartSamples: input.sampleTime,
        blockEndSamples: input.sampleTime + (input.blockSize ?? 128),
        transport: transportInfo,
    });
}
