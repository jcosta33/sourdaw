export type RequestMetricNumber = {
    start: number;
    candidateId: string;
    token: string;
    value: number;
    unit: 'LUFS' | 'dBTP' | 'dBFS' | 'Hz';
    metricId: 'integratedLoudness' | 'truePeak' | 'rms' | 'spectralCentroid';
};

const metricByUnit = {
    LUFS: 'integratedLoudness',
    dBTP: 'truePeak',
    dBFS: 'rms',
    Hz: 'spectralCentroid',
} as const;

const canonicalUnits: readonly RequestMetricNumber['unit'][] = ['LUFS', 'dBTP', 'dBFS', 'Hz'];

/** A request may write a unit in any case; every reader sees its one canonical spelling. */
function canonicalUnit(written: string): RequestMetricNumber['unit'] | undefined {
    const lowered = written.toLowerCase().replace(/\s+/gu, '');
    if (lowered === 'lkfs') return 'LUFS';
    if (lowered === 'khz') return 'Hz';
    return canonicalUnits.find((unit) => unit.toLowerCase() === lowered);
}

/** Source spans, not semantic intent: every candidate needs selection or a literal Command witness. */
export function readRequestMetricNumbers(prompt: string): RequestMetricNumber[] {
    const numbers: RequestMetricNumber[] = [];
    for (const match of prompt.matchAll(/(?<![\w.])(-?\d+(?:\.\d+)?)\s*(LUFS|LKFS|dB\s*TP|dBFS|kHz|Hz)\b/giu)) {
        const value = Number(match[1]) * (match[2]?.toLowerCase() === 'khz' ? 1000 : 1);
        const unit = canonicalUnit(match[2] ?? '');
        if (!Number.isFinite(value) || unit === undefined) {
            continue;
        }
        numbers.push({
            start: match.index,
            candidateId: `number:${String(match.index)}`,
            token: match[0],
            value,
            unit,
            metricId: metricByUnit[unit],
        });
    }
    return numbers;
}
