import { getTempoAtBeat } from '../models/TempoMap';

import { tempoMapStore } from './tempoMapStore';
import { transportStore } from './transportStore';

type ReadTempoAtBeatInput = {
    beat: number;
};

export function readTempoAtBeat({ beat }: ReadTempoAtBeatInput): number {
    return getTempoAtBeat(tempoMapStore.value?.changes ?? [], beat, transportStore.value?.tempo ?? 120);
}
