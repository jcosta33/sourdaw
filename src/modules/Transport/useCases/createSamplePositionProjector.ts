import { samplesToBeat } from '../models/TempoMap';
import { tempoMapStore, type TempoMapStoreState } from '../stores/tempoMapStore';
import { DEFAULT_TEMPO_BPM, transportStore, type TransportState } from '../stores/transportStore';

type SamplePositionSource = {
    transport: Pick<TransportState, 'tempo'> | null;
    tempoMap: TempoMapStoreState | null;
};

export function createSamplePositionProjector(
    source: SamplePositionSource = {
        transport: transportStore.value,
        tempoMap: tempoMapStore.value,
    }
) {
    const defaultTempo = source.transport?.tempo ?? DEFAULT_TEMPO_BPM;
    const tempoChanges = structuredClone(source.tempoMap?.changes ?? []);

    return ({ samples, sampleRate }: { samples: number; sampleRate: number }): number =>
        samplesToBeat(tempoChanges, samples, defaultTempo, sampleRate);
}
