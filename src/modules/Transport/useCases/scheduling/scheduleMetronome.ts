import { inject } from '#/infra/di/inject';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { type TransportState } from '../../models/TransportState';
import { getTempoAtBeat } from '../../models/TempoMap';
import { getTimeSignatureAtBeat } from '../../models/TimeSignatureMap';
import { getCurrentTime, scheduleClick } from '#/modules/AudioEngine/useCases';

export let lastMetronomeBeat = -1;

export function resetMetronomeBeat(position: number): void {
    lastMetronomeBeat = Math.floor(position) - 1;
}

export const scheduleMetronomeDependencies = {
    tempoMapStore,
    timeSignatureMapStore,
    getTempoAtBeat,
    getCurrentTime,
    scheduleClick,
    getTimeSignatureAtBeat,
} as const;

export const scheduleMetronome = inject(scheduleMetronomeDependencies)(
    ({
        tempoMapStore,
        timeSignatureMapStore,
        getTempoAtBeat,
        getCurrentTime,
        scheduleClick,
        getTimeSignatureAtBeat,
    }) =>
        function scheduleMetronome(
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
);
