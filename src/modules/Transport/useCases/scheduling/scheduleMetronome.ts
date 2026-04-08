import { transportStore } from '../../stores/transportStore';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { getTempoAtBeat } from '../../models/TempoMap';
import { getTimeSignatureAtBeat } from '../../models/TimeSignatureMap';
import { getCurrentTime, scheduleClick } from '#/modules/AudioEngine';

export let lastMetronomeBeat = -1;

export function resetMetronomeBeat(position: number): void {
    lastMetronomeBeat = Math.floor(position) - 1;
}

export function scheduleMetronome(
    fromBeat: number,
    toBeat: number,
    accumulatedPosition: number,
    transport: NonNullable<typeof transportStore.value>,
    _currentTempo: number
): void {
    if (!transport.metronomeEnabled) {
        return;
    }

    const startBeatInt = Math.ceil(fromBeat);
    const endBeatInt = Math.floor(toBeat);
    const tsChanges = timeSignatureMapStore.value?.changes ?? [];

    for (let beat = startBeatInt; beat <= endBeatInt; beat++) {
        if (beat <= lastMetronomeBeat) {
            continue;
        }
        lastMetronomeBeat = beat;

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
