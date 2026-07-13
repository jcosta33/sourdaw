import { tempoMapStore } from '../../stores/tempoMapStore';

type ReplaceTempoMapInput = {
    changes: Array<{
        beat: number;
        tempo: number;
        curve: 'instant' | 'linear';
    }>;
};

export function replaceTempoMap(input: ReplaceTempoMapInput): void {
    const changes = input.changes.map((change) => ({
        id: `tempo-${crypto.randomUUID().slice(0, 8)}`,
        beat: change.beat,
        tempo: change.tempo,
        curve: change.curve,
    }));

    tempoMapStore.set({ changes });
}
