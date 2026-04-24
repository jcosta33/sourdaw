const SILENCE_FLOOR_DB = -100;

export type FrequencyBands = {
    sub: number;
    bass: number;
    lowMid: number;
    mid: number;
    highMid: number;
    high: number;
};

const BAND_RANGES: Array<{ key: keyof FrequencyBands; low: number; high: number }> = [
    { key: 'sub', low: 20, high: 60 },
    { key: 'bass', low: 60, high: 250 },
    { key: 'lowMid', low: 250, high: 500 },
    { key: 'mid', low: 500, high: 2000 },
    { key: 'highMid', low: 2000, high: 6000 },
    { key: 'high', low: 6000, high: 20000 },
];

export function readFrequencyBalance(analyser: AnalyserNode): FrequencyBands {
    const binCount = analyser.frequencyBinCount;
    const data = new Float32Array(binCount);
    analyser.getFloatFrequencyData(data);

    const sampleRate = analyser.context.sampleRate;
    const binWidth = sampleRate / (binCount * 2);

    const bands: FrequencyBands = {
        sub: SILENCE_FLOOR_DB,
        bass: SILENCE_FLOOR_DB,
        lowMid: SILENCE_FLOOR_DB,
        mid: SILENCE_FLOOR_DB,
        highMid: SILENCE_FLOOR_DB,
        high: SILENCE_FLOOR_DB,
    };

    for (const { key, low, high } of BAND_RANGES) {
        const startBin = Math.max(1, Math.floor(low / binWidth));
        const endBin = Math.min(binCount - 1, Math.ceil(high / binWidth));

        let sum = 0;
        let count = 0;
        for (let index = startBin; index <= endBin; index++) {
            const dbVal = data[index] ?? SILENCE_FLOOR_DB;
            sum += 10 ** (dbVal / 10);
            count++;
        }

        if (count > 0) {
            bands[key] = 10 * Math.log10(sum / count);
        }
    }

    return bands;
}
