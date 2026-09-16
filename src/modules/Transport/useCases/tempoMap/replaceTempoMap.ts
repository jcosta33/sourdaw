import { MAX_TEMPO_MAP_TEMPO, MIN_TEMPO_MAP_TEMPO } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';

type ReplaceTempoMapInput = {
    changes: Array<{
        beat: number;
        tempo: number;
        curve: 'instant' | 'linear';
    }>;
};

export function replaceTempoMap(input: ReplaceTempoMapInput): void {
    for (const change of input.changes) {
        if (!Number.isFinite(change.beat) || change.beat < 0) {
            throw new RangeError('Tempo-map beat must be finite and non-negative');
        }
        if (
            !Number.isFinite(change.tempo) ||
            change.tempo < MIN_TEMPO_MAP_TEMPO ||
            change.tempo > MAX_TEMPO_MAP_TEMPO
        ) {
            throw new RangeError(`Tempo must be finite and between ${MIN_TEMPO_MAP_TEMPO} and ${MAX_TEMPO_MAP_TEMPO}`);
        }
        const curve: string = change.curve;
        if (curve !== 'instant' && curve !== 'linear') {
            throw new RangeError('Tempo curve must be "instant" or "linear"');
        }
    }

    const changes = input.changes.map((change) => ({
        id: `tempo-${crypto.randomUUID().slice(0, 8)}`,
        beat: change.beat,
        tempo: change.tempo,
        curve: change.curve,
    }));

    tempoMapStore.set({ changes });
}
