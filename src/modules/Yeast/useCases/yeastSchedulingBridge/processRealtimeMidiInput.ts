import { transportStore } from '#/modules/Transport/stores';

import { getYeastSchedulingLookahead } from '../getYeastSchedulingLookahead';

import { processYeastMidi } from './processYeastMidi';

import type { MidiEvent, TransportInfo } from '../../models/MidiEvent';

type ProcessRealtimeMidiInputInput = {
    context: BaseAudioContext;
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
        timePpq: transportStore.value?.playheadPosition,
        tempoBpm: transportStore.value?.tempo,
        sourceEventId: `${input.trackId}:${input.channel}:${input.note}:${input.isNoteOn ? 'on' : 'off'}:${input.sampleTime}`,
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

    const { lateBeats } = getYeastSchedulingLookahead();
    const clockedHorizonSamples = Math.ceil(((input.sampleRate * 60) / transport.tempo) * lateBeats) + 1;

    return processYeastMidi({
        context: input.context,
        trackId: input.trackId,
        events: [event],
        blockStartSamples: input.sampleTime,
        blockEndSamples: input.sampleTime + Math.max(input.blockSize ?? 128, clockedHorizonSamples),
        transport: transportInfo,
    });
}
