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
    noteInstanceId?: string;
    clock: {
        ppqPosition: number;
        bpm: number;
        barIndex: number;
        beatInBar: number;
        timeSigNum: number;
        timeSigDen: number;
    } | null;
    blockSize?: number;
};

export function processRealtimeMidiInput(input: ProcessRealtimeMidiInputInput): Promise<MidiEvent[]> {
    const clock = input.clock;
    const event: MidiEvent = {
        timeSamples: input.sampleTime,
        timePpq: clock?.ppqPosition,
        tempoBpm: clock?.bpm,
        sourceEventId: `${input.trackId}:${input.channel}:${input.note}:${input.isNoteOn ? 'on' : 'off'}:${input.sampleTime}`,
        noteInstanceId: input.noteInstanceId,
        trackId: input.trackId,
        kind: input.isNoteOn
            ? { type: 'noteOn', channel: input.channel, note: input.note, velocity: input.velocity }
            : { type: 'noteOff', channel: input.channel, note: input.note },
    };

    const transport = transportStore.value;
    if (!transport || !clock) {
        return Promise.resolve([event]);
    }

    const transportInfo: TransportInfo = {
        sampleRate: input.sampleRate,
        bpm: clock.bpm,
        ppqPosition: clock.ppqPosition,
        isPlaying: transport.isPlaying,
        barIndex: clock.barIndex,
        beatInBar: clock.beatInBar,
        timeSigNum: clock.timeSigNum,
        timeSigDen: clock.timeSigDen,
        loopEnabled: transport.loopStart < transport.loopEnd,
        loopStartPpq: transport.loopStart,
        loopEndPpq: transport.loopEnd,
    };

    const { lateBeats } = getYeastSchedulingLookahead();
    const clockedHorizonSamples = Math.ceil(((input.sampleRate * 60) / clock.bpm) * lateBeats) + 1;

    return processYeastMidi({
        context: input.context,
        trackId: input.trackId,
        events: [event],
        blockStartSamples: input.sampleTime,
        blockEndSamples: input.sampleTime + Math.max(input.blockSize ?? 128, clockedHorizonSamples),
        transport: transportInfo,
    });
}
