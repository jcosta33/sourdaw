import { getCurrentTime, scheduleClick } from '#/modules/AudioEngine/useCases';

import { getTempoAtBeat } from '../../models/TempoMap';
import { getTimeSignatureAtBeat } from '../../models/TimeSignatureMap';
import { type TransportState } from '../../models/TransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

import {
    CLICK_DEDUP_RETENTION_SECONDS,
    CLICK_TIME_EPSILON,
    metronomeSchedulingState,
} from './metronomeSchedulingState';

/**
 * Records the audioContextTime of every click we have already emitted so a
 * single physical downbeat is never scheduled twice. On a loop-wrap to an
 * integer loopEnd the pre-wrap look-ahead has already fired `floor(loopEnd)`;
 * the wrap then resets `metronomeSchedulingState.lastBeat` low and re-enables
 * the wrapped downbeat (relabeled to `floor(loopStart)`), which resolves to the
 * *same* audioContextTime — the same audible click. Deduping by audioContextTime
 * suppresses that repeat across the beat-number relabel, while the genuinely-
 * next loop iteration's downbeat (a strictly later time) still sounds. Entries
 * are dropped once their click time has elapsed so the map stays bounded.
 */
export function scheduleMetronome(
    fromBeat: number,
    toBeat: number,
    accumulatedPosition: number,
    transport: TransportState,
    _currentTempo: number
): void {
    if (!transport.metronomeEnabled) {
        return;
    }

    const startBeatInt = Math.ceil(fromBeat);
    const endBeatInt = Math.floor(toBeat);
    const tsChanges = timeSignatureMapStore.value?.changes ?? [];

    const nowTime = getCurrentTime();
    // Drop dedup entries whose click time played longer ago than the widest wrap
    // overshoot the scheduler can carry, so the map stays bounded without losing
    // the seam entry before the wrap that has to match it arrives.
    for (const [key, firedTime] of metronomeSchedulingState.firedClickTimes) {
        if (firedTime < nowTime - CLICK_DEDUP_RETENTION_SECONDS) {
            metronomeSchedulingState.firedClickTimes.delete(key);
        }
    }

    for (let beat = startBeatInt; beat <= endBeatInt; beat++) {
        if (beat <= metronomeSchedulingState.lastBeat) {
            continue;
        }
        metronomeSchedulingState.lastBeat = beat;

        const beatTempo = getTempoAtBeat(tempoMapStore.value?.changes ?? [], beat, transport.tempo);
        const beatOffset = beat - accumulatedPosition;
        const time = nowTime + beatOffset / (beatTempo / 60);

        // Suppress a second click at the same instant — the loop-wrap double-fire
        // of an integer loopEnd downbeat re-emitted as the wrapped loopStart beat.
        const timeKey = Math.round(time / CLICK_TIME_EPSILON);
        if (metronomeSchedulingState.firedClickTimes.has(timeKey)) {
            continue;
        }
        metronomeSchedulingState.firedClickTimes.set(timeKey, time);

        const ts = getTimeSignatureAtBeat(
            tsChanges,
            beat,
            transport.timeSignatureNumerator,
            transport.timeSignatureDenominator
        );
        const isAccent = beat % ts.numerator === 0;
        scheduleClick(time, isAccent, transport.metronomeVolume);
    }
}
