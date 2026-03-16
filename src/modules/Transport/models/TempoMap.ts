export type TempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: "instant" | "linear";
};

let nextTempoChangeId = 1;

export const createTempoChange = (beat: number, tempo: number, curve: TempoChange["curve"] = "instant"): TempoChange => ({
    id: `tempo-${nextTempoChangeId++}`,
    beat,
    tempo: Math.max(20, Math.min(999, tempo)),
    curve,
});

export const getTempoAtBeat = (changes: TempoChange[], beat: number, defaultTempo: number): number => {
    if (changes.length === 0) return defaultTempo;

    const sorted = [...changes].sort((a, b) => a.beat - b.beat);
    const before = sorted.filter((c) => c.beat <= beat);
    const after = sorted.filter((c) => c.beat > beat);

    if (before.length === 0) return sorted[0]!.tempo;
    if (after.length === 0) return before[before.length - 1]!.tempo;

    const prev = before[before.length - 1]!;
    const next = after[0]!;

    if (prev.curve === "instant") return prev.tempo;

    const t = (beat - prev.beat) / (next.beat - prev.beat);
    return prev.tempo + (next.tempo - prev.tempo) * t;
};
