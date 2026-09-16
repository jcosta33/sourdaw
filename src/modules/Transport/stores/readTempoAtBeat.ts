import { getTempoAtBeat } from '../models/TempoMap';

import { tempoMapStore } from './tempoMapStore';
import { DEFAULT_TEMPO_BPM, transportStore } from './transportStore';

type ReadTempoAtBeatInput = {
    beat: number;
};

export function readTempoAtBeat({ beat }: ReadTempoAtBeatInput): number {
    return getTempoAtBeat(tempoMapStore.value?.changes ?? [], beat, transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM);
}
