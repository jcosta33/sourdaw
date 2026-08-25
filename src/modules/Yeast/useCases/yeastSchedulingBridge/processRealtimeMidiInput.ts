import { transportStore } from '#/modules/Transport/stores';

import { getYeastSchedulingLookahead } from '../getYeastSchedulingLookahead';

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
    noteInstanceId?: string;
    blockSize?: number;
};

const REALTIME_WORKER_LOOKAHEAD_SECONDS = 0.1;

function beatsToSamples(beats: number, bpm: number, sampleRate: number): number {
    return Math.ceil((beats * 60 * sampleRate) / bpm);
}

function samplesToBeats(samples: number, bpm: number, sampleRate: number): number {
    return (samples * bpm) / (60 * sampleRate);
}

export function processRealtimeMidiInput(input: ProcessRealtimeMidiInputInput): Promise<MidiEvent[]> {
    function createEvent(timeSamples: number): MidiEvent {
        return {
            timeSamples,
            trackId: input.trackId,
            sourceEventId: `${input.trackId}:${input.channel}:${input.note}:${input.isNoteOn ? 'on' : 'off'}:${input.sampleTime}`,
            noteInstanceId: input.noteInstanceId,
            kind: input.isNoteOn
                ? { type: 'noteOn', channel: input.channel, note: input.note, velocity: input.velocity }
                : { type: 'noteOff', channel: input.channel, note: input.note },
        };
    }

    const transport = transportStore.value;
    if (!transport) {
        return Promise.resolve([createEvent(input.sampleTime)]);
    }

    const { earlyBeats, lateBeats } = getYeastSchedulingLookahead(input.rackId);
    const workerLookaheadSamples = Math.ceil(input.sampleRate * REALTIME_WORKER_LOOKAHEAD_SECONDS);
    const earlySamples = beatsToSamples(earlyBeats, transport.tempo, input.sampleRate);
    const lateSamples = beatsToSamples(lateBeats, transport.tempo, input.sampleRate);
    const eventSampleTime = input.sampleTime + workerLookaheadSamples + earlySamples;
    const event = createEvent(eventSampleTime);
    const minimumBlockEnd = input.sampleTime + (input.blockSize ?? 128);
    const grooveBlockEnd = eventSampleTime + lateSamples + 1;
    const schedulingDelayBeats = samplesToBeats(eventSampleTime - input.sampleTime, transport.tempo, input.sampleRate);

    const transportInfo: TransportInfo = {
        sampleRate: input.sampleRate,
        bpm: transport.tempo,
        ppqPosition: transport.playheadPosition - schedulingDelayBeats,
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
        blockEndSamples: Math.max(minimumBlockEnd, grooveBlockEnd),
        transport: transportInfo,
    });
}
