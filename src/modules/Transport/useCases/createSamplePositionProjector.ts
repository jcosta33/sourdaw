import { samplesToBeat } from '../models/TempoMap';
import { tempoMapStore } from '../stores/tempoMapStore';
import { transportStore } from '../stores/transportStore';

export function createSamplePositionProjector() {
    const defaultTempo = transportStore.value?.tempo ?? 120;
    const tempoChanges = structuredClone(tempoMapStore.value?.changes ?? []);

    return ({ samples, sampleRate }: { samples: number; sampleRate: number }): number =>
        samplesToBeat(tempoChanges, samples, defaultTempo, sampleRate);
}
