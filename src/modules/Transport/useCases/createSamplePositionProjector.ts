import { samplesToBeat } from '../models/TempoMap';
import { tempoMapStore } from '../stores/tempoMapStore';
import { DEFAULT_TEMPO_BPM, transportStore } from '../stores/transportStore';

export function createSamplePositionProjector() {
    const defaultTempo = transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM;
    const tempoChanges = structuredClone(tempoMapStore.value?.changes ?? []);

    return ({ samples, sampleRate }: { samples: number; sampleRate: number }): number =>
        samplesToBeat(tempoChanges, samples, defaultTempo, sampleRate);
}
