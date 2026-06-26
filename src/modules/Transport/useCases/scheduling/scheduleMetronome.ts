import { getCurrentTime, scheduleClick } from '#/modules/AudioEngine/useCases';

import { getTempoAtBeat } from '../../models/TempoMap';
import { getTimeSignatureAtBeat } from '../../models/TimeSignatureMap';
import { type TransportState } from '../../models/TransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

let _lastMetronomeBeat = -1;

/**
 * Records the audioContextTime of every click we have already emitted so a
 * single physical downbeat is never scheduled twice. On a loop-wrap to an
 * integer loopEnd the pre-wrap look-ahead has already fired `floor(loopEnd)`;
 * the wrap then resets `_lastMetronomeBeat` low and re-enables the wrapped
 * downbeat (relabeled to `floor(loopStart)`), which resolves to the *same*
 * audioContextTime — the same audible click. Deduping by audioContextTime
 * suppresses that repeat across the beat-number relabel, while the genuinely-
 * next loop iteration's downbeat (a strictly later time) still sounds. Entries
 * are dropped once their click time has elapsed so the map stays bounded.
 */
const _firedClickTimes = new Map<number, number>();

/** Float tolerance for treating two scheduled click times as the same instant. */
const CLICK_TIME_EPSILON = 1e-4;

export function resetMetronomeBeat(position: number): void {
    _lastMetronomeBeat = Math.floor(position) - 1;
    // NB: `_firedClickTimes` is deliberately NOT cleared here. The loop-wrap and
    // follow-action-jump paths call this *while still inside the look-ahead window*
    // of the click we are guarding against, so wiping it would re-enable the very
    // double-fire we suppress. The time-based pruning in scheduleMetronome keeps
    // the map bounded; entries always lie in the future of getCurrentTime() until
    // played, after which they are dropped.
}

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
    // Drop dedup entries whose click time has already played so the map stays bounded.
    for (const [key, firedTime] of _firedClickTimes) {
        if (firedTime < nowTime - CLICK_TIME_EPSILON) {
            _firedClickTimes.delete(key);
        }
    }

    for (let beat = startBeatInt; beat <= endBeatInt; beat++) {
        if (beat <= _lastMetronomeBeat) {
            continue;
        }
        _lastMetronomeBeat = beat;

        const beatTempo = getTempoAtBeat(tempoMapStore.value?.changes ?? [], beat, transport.tempo);
        const beatOffset = beat - accumulatedPosition;
        const time = nowTime + beatOffset / (beatTempo / 60);

        // Suppress a second click at the same instant — the loop-wrap double-fire
        // of an integer loopEnd downbeat re-emitted as the wrapped loopStart beat.
        const timeKey = Math.round(time / CLICK_TIME_EPSILON);
        if (_firedClickTimes.has(timeKey)) {
            continue;
        }
        _firedClickTimes.set(timeKey, time);

        const ts = getTimeSignatureAtBeat(
            tsChanges,
            beat,
            transport.timeSignatureNumerator,
            transport.timeSignatureDenominator
        );
        const isAccent = beat % ts.numerator === 0;
        scheduleClick(time, isAccent, transport.metronomeVolume ?? 0.5);
    }
}
