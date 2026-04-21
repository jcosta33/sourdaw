const SILENCE_FLOOR_DB = -100;

function linearToDb(linear: number): number {
    if (linear <= 0) {
        return SILENCE_FLOOR_DB;
    }
    return 20 * Math.log10(linear);
}

export type LevelReading = { peakDb: number; rmsDb: number };

export function readLevels(analyser: AnalyserNode): LevelReading {
    const data = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatTimeDomainData(data);

    let peak = 0;
    let sumSquares = 0;

    for (let index = 0; index < data.length; index++) {
        const sample = data[index]!;
        const abs = Math.abs(sample);
        if (abs > peak) {
            peak = abs;
        }
        sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / data.length);

    return {
        peakDb: linearToDb(peak),
        rmsDb: linearToDb(rms),
    };
}
