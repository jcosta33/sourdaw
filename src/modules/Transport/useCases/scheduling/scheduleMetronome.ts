import { getCurrentTime, scheduleClick } from '#/modules/AudioEngine/useCases';

import { getTempoAtBeat } from '../../models/TempoMap';
import { getTimeSignatureAtBeat } from '../../models/TimeSignatureMap';
import { type TransportState } from '../../models/TransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

let _lastMetronomeBeat = -1;

export function getLastMetronomeBeat(): number {
    return _lastMetronomeBeat;
}

export function resetMetronomeBeat(position: number): void {
    _lastMetronomeBeat = Math.floor(position) - 1;
}

export const scheduleMetronomeDependencies = {
    tempoMapStore,
    timeSignatureMapStore,
    getTempoAtBeat,
    getCurrentTime,
    scheduleClick,
    getTimeSignatureAtBeat,
} as const;

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

    for (let beat = startBeatInt; beat <= endBeatInt; beat++) {
        if (beat <= _lastMetronomeBeat) {
            continue;
        }
        _lastMetronomeBeat = beat;

        const beatTempo = getTempoAtBeat(tempoMapStore.value?.changes ?? [], beat, transport.tempo);
        const beatOffset = beat - accumulatedPosition;
        const time = getCurrentTime() + beatOffset / (beatTempo / 60);
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
