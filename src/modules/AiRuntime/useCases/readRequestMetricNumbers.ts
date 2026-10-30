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

/** Source spans, not semantic intent: every candidate needs selection or a literal Command witness. */
export function readRequestMetricNumbers(prompt: string): RequestMetricNumber[] {
    const numbers: RequestMetricNumber[] = [];
    for (const match of prompt.matchAll(/(?<![\w.])(-?\d+(?:\.\d+)?)\s*(LUFS|dBTP|dBFS|Hz)\b/gu)) {
        const value = Number(match[1]);
        const unit = match[2] as RequestMetricNumber['unit'];
        if (!Number.isFinite(value)) {
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
