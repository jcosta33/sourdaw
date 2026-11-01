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
 * Clicks the metrical beats of `[fromBeat, toBeat]` for the pass anchored at
 * `accumulatedPosition`.
 *
 * While that pass is inside an engaged loop it never clicks at or past exact
 * loopEnd: loopEnd is the incoming pass's loopStart instant, so the seam click
 * belongs to the incoming pass. Its beat decides whether the seam clicks at all
 * (an off-grid loopStart is silent) and which accent it carries. Without a loop
 * the window is inclusive at both ends.
 *
 * Every emitted click's audioContextTime is also recorded, so a window re-opened
 * over already-scheduled beats (a lowered `lastBeat` after a relocation or an
 * edit's re-anchor) never schedules the same instant twice. Entries are dropped
 * once their click time has elapsed so the map stays bounded.
 */
export function scheduleMetronome(
    fromBeat: number,
    toBeat: number,
    accumulatedPosition: number,
    transport: TransportState,
    initialSchedulingAnchor?: number
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

    const loopEnd = engagedLoopEnd(transport, accumulatedPosition);

    for (const beat of clickBeats) {
        // Fenced before `lastBeat` and the time key move, so the incoming pass
        // can still claim the seam instant with its own beat.
        if (beat >= loopEnd) {
            continue;
        }
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
        const time =
            (initialSchedulingAnchor ?? nowTime) +
            secondsBetweenBeats(tempoChanges, accumulatedPosition, beat, transport.tempo);

        // Suppress a second click at an instant this window already scheduled.
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

/**
 * The exclusive end of the pass anchored at `position`, by the scheduler's own
 * engagement rule: a pass at or past loopEnd plays straight through, so only a
 * pass before loopEnd is fenced.
 */
function engagedLoopEnd(transport: TransportState, position: number): number {
    const engaged = transport.isLooping && transport.loopEnd > transport.loopStart && position < transport.loopEnd;
    return engaged ? transport.loopEnd : Infinity;
}
