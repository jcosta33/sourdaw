import { transportStore } from '#/modules/Transport/stores';

import { getYeastSchedulingLookahead } from '../getYeastSchedulingLookahead';

import { processYeastMidi } from './processYeastMidi';
import { startYeastIdleDrain } from './startYeastIdleDrain';

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
    /**
     * Deliver only while this rack's projection is the one the worker runs;
     * otherwise do nothing, never switching the worker to the rack.
     */
    onlyWhileRackCurrent?: boolean;
    /**
     * Drained batches from the idle pump this input starts (#4870). While the
     * transport is stopped and this input is the rack's only driver, generated
     * and deferred events reach their block only if empty blocks keep being
     * processed; the receiver owns voicing them on their instrument routes.
     * Returning `false` from the callback cancels the remaining drain.
     */
    onDrainedEvents?: (events: readonly MidiEvent[]) => boolean | void;
};

const REALTIME_WORKER_LOOKAHEAD_SECONDS = 0.1;

function beatsToSamples(beats: number, bpm: number, sampleRate: number): number {
    return Math.ceil((beats * 60 * sampleRate) / bpm);
}

function samplesToBeats(samples: number, bpm: number, sampleRate: number): number {
    return (samples * bpm) / (60 * sampleRate);
}

/** Furthest sample time a processed batch's note lifetimes still owe events. */
function drainHorizonSamples(events: readonly MidiEvent[], floorSamples: number): number {
    let horizon = floorSamples;
    for (const event of events) {
        if (event.kind.type === 'noteOn' && event.durationSamples !== undefined) {
            horizon = Math.max(horizon, event.timeSamples + event.durationSamples);
        }
    }
    return horizon;
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
    const blockEndSamples = Math.max(minimumBlockEnd, grooveBlockEnd);
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

    const routeId = input.routeId ?? input.trackId;
    const { onDrainedEvents } = input;
    return processYeastMidi({
        context: input.context,
        rackId: input.rackId,
        routeId,
        trackId: input.trackId,
        events: [event],
        blockStartSamples: input.sampleTime,
        blockEndSamples,
        transport: transportInfo,
        onlyWhileRackCurrent: input.onlyWhileRackCurrent,
    }).then((processed) => {
        if (onDrainedEvents === undefined || transport.isPlaying || processed.length === 0) {
            return processed;
        }
        const horizonSamples = drainHorizonSamples(processed, blockEndSamples);
        if (horizonSamples <= blockEndSamples) {
            // Nothing the block emitted outlives it; no later block is owed.
            return processed;
        }
        // #4870 — with the transport stopped and no clip carrier this input is
        // the rack's only driver: keep feeding it empty blocks until every
        // generated/deferred event has reached its block.
        startYeastIdleDrain({
            context: input.context,
            rackId: input.rackId,
            routeId,
            trackId: input.trackId,
            transport: transportInfo,
            firstBlockEndSamples: blockEndSamples,
            horizonSamples,
            strideSamples: workerLookaheadSamples,
            onEvents: onDrainedEvents,
        });
        return processed;
    });
}
