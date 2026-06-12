/**
 * Pure audio-signal helpers used by `analyzeMix`. Owned by AudioAnalysis
 * (previously sourced from AiRuntime); moving them here breaks the
 * `AudioAnalysis ↔ AiRuntime` barrel cycle without changing behaviour.
 */

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
        for (let i = startBin; i <= endBin; i++) {
            const dbVal = data[i] ?? SILENCE_FLOOR_DB;
            sum += 10 ** (dbVal / 10);
            count++;
        }

        if (count > 0) {
            bands[key] = 10 * Math.log10(sum / count);
        }
    }

    return bands;
}

export type TrackLevelSummary = {
    trackId: string;
    trackName: string;
    peakDb: number;
    rmsDb: number;
    isMuted: boolean;
    isSoloed: boolean;
    isClipping: boolean;
};

export type MixIssue = {
    severity: 'info' | 'warning' | 'critical';
    category: 'level' | 'frequency' | 'stereo' | 'dynamics';
    message: string;
    trackId?: string;
};

export type DetectIssuesInput = {
    masterLevels: LevelReading;
    bands: FrequencyBands;
    trackLevels: TrackLevelSummary[];
};

export function detectIssues({ masterLevels, bands, trackLevels }: DetectIssuesInput): MixIssue[] {
    const issues: MixIssue[] = [];

    for (const tl of trackLevels) {
        if (tl.isClipping) {
            issues.push({
                severity: 'critical',
                category: 'level',
                message: `${tl.trackName} is clipping at ${tl.peakDb.toFixed(1)} dB`,
                trackId: tl.trackId,
            });
        }
    }

    if (masterLevels.peakDb > -3) {
        issues.push({
            severity: 'warning',
            category: 'level',
            message: `Master peak is ${masterLevels.peakDb.toFixed(1)} dB — low headroom`,
        });
    }

    const lowEnergy = (bands.sub + bands.bass) / 2;
    const highEnergy = (bands.mid + bands.high) / 2;
    if (lowEnergy - highEnergy > 6) {
        issues.push({
            severity: 'warning',
            category: 'frequency',
            message: `Mix is muddy — low-end energy exceeds mids/highs by ${(lowEnergy - highEnergy).toFixed(1)} dB`,
        });
    }

    if (bands.highMid - bands.mid > 6) {
        issues.push({
            severity: 'warning',
            category: 'frequency',
            message: `Mix is harsh — high-mid energy exceeds mids by ${(bands.highMid - bands.mid).toFixed(1)} dB`,
        });
    }

    for (const tl of trackLevels) {
        if (tl.isMuted) {
            issues.push({
                severity: 'info',
                category: 'level',
                message: `${tl.trackName} is muted`,
                trackId: tl.trackId,
            });
        }
    }

    const activeTracks = trackLevels.filter((track) => !track.isMuted && track.peakDb > SILENCE_FLOOR_DB);
    if (activeTracks.length >= 2) {
        const peaks = activeTracks.map((track) => track.peakDb);
        const maxPeak = Math.max(...peaks);
        const minPeak = Math.min(...peaks);
        if (maxPeak - minPeak > 20) {
            const loudest = activeTracks.find((track) => track.peakDb === maxPeak);
            const quietest = activeTracks.find((track) => track.peakDb === minPeak);
            issues.push({
                severity: 'info',
                category: 'level',
                message: `Track levels differ by ${(maxPeak - minPeak).toFixed(1)} dB (${loudest?.trackName} vs ${quietest?.trackName})`,
            });
        }
    }

    return issues;
}

export type GenerateSuggestionsInput = {
    masterLevels: LevelReading;
    bands: FrequencyBands;
    trackLevels: TrackLevelSummary[];
    issues: MixIssue[];
};

export function generateSuggestions({ masterLevels, bands, trackLevels, issues }: GenerateSuggestionsInput): string[] {
    const suggestions: string[] = [];

    for (const tl of trackLevels) {
        if (tl.isClipping) {
            const overshoot = tl.peakDb + 0.5;
            suggestions.push(`${tl.trackName} is clipping — reduce gain by at least ${overshoot.toFixed(1)} dB`);
        }
    }

    if (masterLevels.peakDb > -3) {
        const reduction = masterLevels.peakDb + 6;
        suggestions.push(
            `Master is hot at ${masterLevels.peakDb.toFixed(1)} dB — reduce by ${reduction.toFixed(1)} dB to leave headroom for mastering`
        );
    }

    const lowEnergy = (bands.sub + bands.bass) / 2;
    const highEnergy = (bands.mid + bands.high) / 2;
    if (lowEnergy - highEnergy > 6) {
        suggestions.push('Consider applying a high-pass filter on non-bass tracks to reduce low-end buildup');
    }

    if (bands.highMid - bands.mid > 6) {
        suggestions.push('Consider a gentle cut around 2–6 kHz on bright tracks to tame harshness');
    }

    if (issues.length === 0) {
        suggestions.push('Mix has good frequency balance and healthy levels');
    }

    return suggestions;
}
