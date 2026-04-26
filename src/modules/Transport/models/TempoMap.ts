export type TempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

export function createTempoChange(beat: number, tempo: number, curve: TempoChange['curve'] = 'instant'): TempoChange {
    return {
        id: `tempo-${crypto.randomUUID()}`,
        beat,
        tempo: Math.max(20, Math.min(999, tempo)),
        curve,
    };
}

export function getTempoAtBeat(changes: TempoChange[], beat: number, defaultTempo: number): number {
    if (changes.length === 0) {
        return defaultTempo;
    }

    const sorted = [...changes].sort((alpha, b) => alpha.beat - b.beat);
    const before = sorted.filter((context) => context.beat <= beat);
    const after = sorted.filter((context) => context.beat > beat);

    if (before.length === 0) {
        return sorted[0]!.tempo;
    }
    if (after.length === 0) {
        return before[before.length - 1]!.tempo;
    }

    const prev = before[before.length - 1]!;
    const next = after[0]!;

    if (prev.curve === 'instant') {
        return prev.tempo;
    }

    const time = (beat - prev.beat) / (next.beat - prev.beat);
    return prev.tempo + (next.tempo - prev.tempo) * time;
}
