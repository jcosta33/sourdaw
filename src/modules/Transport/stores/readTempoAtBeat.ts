import { getTempoAtBeat } from '../models/TempoMap';
import { type TempoSourceClock } from '#/utils/tempoAudioSourcePromotion';

import { tempoMapStore } from './tempoMapStore';
import { DEFAULT_TEMPO_BPM, transportStore } from './transportStore';

type ReadTempoAtBeatInput = {
    beat: number;
    clock?: TempoSourceClock;
};

export function readTempoAtBeat({ beat, clock }: ReadTempoAtBeatInput): number {
    return getTempoAtBeat(
        clock?.changes ?? tempoMapStore.value?.changes ?? [],
        beat,
        clock?.tempo ?? transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM
    );
}
