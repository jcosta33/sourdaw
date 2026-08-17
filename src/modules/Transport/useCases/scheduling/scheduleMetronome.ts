import { getCurrentTime, scheduleClick } from '#/modules/AudioEngine/useCases';

import { secondsBetweenBeats } from '../../models/TempoMap';
import { getBarBeatAtPosition, getMetricalBeatsBetween } from '../../models/TimeSignatureMap';
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
    transport: TransportState
): void {
    if (!transport.metronomeEnabled) {
        return;
    }

    const tsChanges = timeSignatureMapStore.value?.changes ?? [];
    const tempoChanges = tempoMapStore.value?.changes ?? [];

    const nowTime = getCurrentTime();
    // Drop dedup entries whose click time played longer ago than the widest wrap
    // overshoot the scheduler can carry, so the map stays bounded without losing
    // the seam entry before the wrap that has to match it arrives.
    for (const [key, firedTime] of metronomeSchedulingState.firedClickTimes) {
        if (firedTime < nowTime - CLICK_DEDUP_RETENTION_SECONDS) {
            metronomeSchedulingState.firedClickTimes.delete(key);
        }
    }

    // Step the meter's beat, not the quarter note. A whole-quarter step handed a
    // 6/8 project a quarter-note click while its own count-in pulsed eighths, and
    // never landed on the odd bar lines of a meter whose bar is a fractional
    // number of quarters (7/8 is 3.5), so the accent fired every other bar.
    const clickBeats = getMetricalBeatsBetween(
        tsChanges,
        fromBeat,
        toBeat,
        transport.timeSignatureNumerator,
        transport.timeSignatureDenominator
    );

    for (const beat of clickBeats) {
        if (beat <= metronomeSchedulingState.lastBeat) {
            continue;
        }
        metronomeSchedulingState.lastBeat = beat;

        // Integrate the map across `[accumulatedPosition, beat]` rather than
        // dividing the whole offset by one tempo. Reading the tempo *at* the
        // click and applying it back to the playhead charges the post-change
        // rate for the beats before the change, so with any tempo change inside
        // the look-ahead the click landed at the wrong instant and drifted
        // against the MIDI path, which has always integrated the map.
        const time = nowTime + secondsBetweenBeats(tempoChanges, accumulatedPosition, beat, transport.tempo);

        // Suppress a second click at the same instant — the loop-wrap double-fire
        // of an integer loopEnd downbeat re-emitted as the wrapped loopStart beat.
        const timeKey = Math.round(time / CLICK_TIME_EPSILON);
        if (metronomeSchedulingState.firedClickTimes.has(timeKey)) {
            continue;
        }
        metronomeSchedulingState.firedClickTimes.set(timeKey, time);

        // The accent marks a bar line, so it has to come from the bar the beat
        // falls in. `beat % numerator === 0` measured bars from the timeline
        // origin instead: after a meter change at any beat the grid it implies
        // no longer lines up with the real bars, and it also read the numerator
        // as a count of quarter notes, so every meter whose denominator is not 4
        // accented the wrong beats even with no change in the project.
        const barPosition = getBarBeatAtPosition(
            tsChanges,
            beat,
            transport.timeSignatureNumerator,
            transport.timeSignatureDenominator
        );
        const isAccent = barPosition.beat === 1 && barPosition.tick === 0;
        scheduleClick(time, isAccent, transport.metronomeVolume);
    }
}
