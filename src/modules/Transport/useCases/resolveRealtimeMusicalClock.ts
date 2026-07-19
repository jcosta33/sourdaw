import { beatToSamples, getTempoAtBeat, samplesToBeat } from '../models/TempoMap';
import { getBarBeatAtPosition, getTimeSignatureAtBeat } from '../models/TimeSignatureMap';
import { playheadPositionRef } from '../stores/playheadPositionRef';
import { tempoMapStore } from '../stores/tempoMapStore';
import { timeSignatureMapStore } from '../stores/timeSignatureMapStore';
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

    const timeSignatureChanges = timeSignatureMapStore.value?.changes ?? [];
    const barBeat = getBarBeatAtPosition(
        timeSignatureChanges,
        ppqPosition,
        transport.timeSignatureNumerator,
        transport.timeSignatureDenominator
    );
    const timeSignature = getTimeSignatureAtBeat(
        timeSignatureChanges,
        ppqPosition,
        transport.timeSignatureNumerator,
        transport.timeSignatureDenominator
    );

    return {
        sampleTime: input.sampleTime,
        ppqPosition,
        bpm: getTempoAtBeat(changes, ppqPosition, transport.tempo),
        barIndex: barBeat.bar - 1,
        beatInBar: barBeat.beat - 1 + barBeat.tick / 480,
        timeSigNum: timeSignature.numerator,
        timeSigDen: timeSignature.denominator,
    };
}
