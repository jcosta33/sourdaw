import { beatToSamples, getTempoAtBeat, samplesToBeat } from '../models/TempoMap';
import { playheadPositionRef } from '../stores/playheadPositionRef';
import { tempoMapStore } from '../stores/tempoMapStore';
import { transportStore } from '../stores/transportStore';

import { schedulerSession } from './playheadScheduler/schedulerSession';

type ResolveRealtimeMusicalClockInput = {
    sampleTime: number;
    sampleRate: number;
};

export function resolveRealtimeMusicalClock(input: ResolveRealtimeMusicalClockInput) {
    const transport = transportStore.value;
    if (!transport) {
        return null;
    }
    const changes = tempoMapStore.value?.changes ?? [];
    const anchorBeat = Number.isFinite(playheadPositionRef.current)
        ? playheadPositionRef.current
        : transport.playheadPosition;
    let ppqPosition = anchorBeat;

    if (
        transport.isPlaying &&
        Number.isFinite(input.sampleTime) &&
        Number.isFinite(input.sampleRate) &&
        input.sampleRate > 0 &&
        Number.isFinite(schedulerSession.lastTickTime)
    ) {
        const anchorTimelineSamples = beatToSamples(changes, anchorBeat, transport.tempo, input.sampleRate);
        const elapsedSamples = input.sampleTime - schedulerSession.lastTickTime * input.sampleRate;
        ppqPosition = samplesToBeat(changes, anchorTimelineSamples + elapsedSamples, transport.tempo, input.sampleRate);
    }

    if (transport.isLooping && transport.loopEnd > transport.loopStart && ppqPosition >= transport.loopEnd) {
        const loopLength = transport.loopEnd - transport.loopStart;
        ppqPosition = transport.loopStart + ((ppqPosition - transport.loopStart) % loopLength);
    }

    return {
        ppqPosition,
        bpm: getTempoAtBeat(changes, ppqPosition, transport.tempo),
    };
}
