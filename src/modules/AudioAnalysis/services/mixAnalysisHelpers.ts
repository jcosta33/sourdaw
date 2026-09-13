/**
 * Pure audio-signal helpers used by `analyzeMix`. Owned by AudioAnalysis
 * (previously sourced from AiRuntime); moving them here breaks the
 * `AudioAnalysis ↔ AiRuntime` barrel cycle without changing behaviour.
 */

export const SILENCE_FLOOR_DB = -100;

/**
 * Where a measurement came from. The analysers are read as instantaneous
 * snapshots; a verdict produced from one is only as good as that snapshot, so
 * the provenance travels with every result instead of being implied.
 */
export type MixEvidenceProvenance = 'live-analyser-snapshot';

/**
 * Whether the snapshot carried enough program evidence to advise on. Silence is
 * a measured state (peak and RMS land exactly on the floor), not a healthy
 * mix, so it is reported as insufficient instead of being advised on.
 */
export type MixEvidenceStatus =
    | { availability: 'measured'; provenance: MixEvidenceProvenance }
    | {
          availability: 'insufficient';
          reason: 'audio-context-suspended' | 'no-signal';
          provenance: MixEvidenceProvenance;
      };

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
    sub: number | null;
    bass: number | null;
    lowMid: number | null;
    mid: number | null;
    highMid: number | null;
    high: number | null;
};

const BAND_RANGES: Array<{ key: keyof FrequencyBands; low: number; high: number }> = [
    { key: 'sub', low: 20, high: 60 },
    { key: 'bass', low: 60, high: 250 },
    { key: 'lowMid', low: 250, high: 500 },
    { key: 'mid', low: 500, high: 2000 },
    { key: 'highMid', low: 2000, high: 6000 },
    { key: 'high', low: 6000, high: 20000 },
];

/**
 * Aggregate one FFT frame into the advertised bands.
 *
 * Each bin is attributed by its center frequency to at most one band
 * (`low <= center < high`), so a bin can never feed two bands' advice. A band
 * with no attributable bin is unresolvable at this analyser's frequency
 * resolution — reported as `null` (unavailable), never as a number invented
 * from a neighboring band's bin. A band with attributable bins but no energy is
 * measured silence and reads the finite floor.
 */
export function readFrequencyBalance(analyser: AnalyserNode): FrequencyBands {
    const binCount = analyser.frequencyBinCount;
    const data = new Float32Array(binCount);
    analyser.getFloatFrequencyData(data);

    const sampleRate = analyser.context.sampleRate;
    const binWidth = sampleRate / (binCount * 2);

    const powerSums: Record<keyof FrequencyBands, number> = {
        sub: 0,
        bass: 0,
        lowMid: 0,
        mid: 0,
        highMid: 0,
        high: 0,
    };
    const binCounts: Record<keyof FrequencyBands, number> = {
        sub: 0,
        bass: 0,
        lowMid: 0,
        mid: 0,
        highMid: 0,
        high: 0,
    };

    // Bin 0 is DC and is never attributed, so a band can only speak for bins
    // that actually lie inside its advertised range.
    for (let i = 1; i < binCount; i++) {
        const centerHz = i * binWidth;
        const band = BAND_RANGES.find((range) => centerHz >= range.low && centerHz < range.high);
        if (!band) {
            continue;
        }
        const dbVal = data[i] ?? SILENCE_FLOOR_DB;
        powerSums[band.key] += Number.isFinite(dbVal) ? 10 ** (dbVal / 10) : 0;
        binCounts[band.key] += 1;
    }

    const bands = {} as FrequencyBands;
    for (const { key } of BAND_RANGES) {
        if (binCounts[key] === 0) {
            bands[key] = null;
        } else if (powerSums[key] === 0) {
            bands[key] = SILENCE_FLOOR_DB;
        } else {
            bands[key] = 10 * Math.log10(powerSums[key] / binCounts[key]);
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
    status: MixEvidenceStatus;
};

export function detectIssues({ masterLevels, bands, trackLevels, status }: DetectIssuesInput): MixIssue[] {
    const issues: MixIssue[] = [];

    if (status.availability === 'insufficient') {
        issues.push({
            severity: 'info',
            category: 'level',
            message:
                status.reason === 'audio-context-suspended'
                    ? 'The audio engine is not running — no mix evidence was measured'
                    : 'No signal measured at the master output — playback is stopped or the section is silent',
        });
        return issues;
    }

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

    const lowBands = [bands.sub, bands.bass];
    const highBands = [bands.mid, bands.high];
    // A band comparison only runs when every band it compares was resolvable;
    // null means "not measured", and advice on unmeasured bands is invented.
    if (lowBands.every((band) => band !== null) && highBands.every((band) => band !== null)) {
        const lowEnergy = (bands.sub! + bands.bass!) / 2;
        const highEnergy = (bands.mid! + bands.high!) / 2;
        if (lowEnergy - highEnergy > 6) {
            issues.push({
                severity: 'warning',
                category: 'frequency',
                message: `Mix is muddy — low-end energy exceeds mids/highs by ${(lowEnergy - highEnergy).toFixed(1)} dB`,
            });
        }
    }

    if (bands.highMid !== null && bands.mid !== null && bands.highMid - bands.mid > 6) {
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
    status: MixEvidenceStatus;
};

export function generateSuggestions({
    masterLevels,
    bands,
    trackLevels,
    issues,
    status,
}: GenerateSuggestionsInput): string[] {
    const suggestions: string[] = [];

    if (status.availability === 'insufficient') {
        suggestions.push(
            status.reason === 'audio-context-suspended'
                ? 'Start the audio engine so the analyser can measure real output before asking for mix advice'
                : 'Start playback (or audition a loud enough section) so the analyser has program material to measure'
        );
        return suggestions;
    }

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

    if (bands.sub !== null && bands.bass !== null && bands.mid !== null && bands.high !== null) {
        const lowEnergy = (bands.sub + bands.bass) / 2;
        const highEnergy = (bands.mid + bands.high) / 2;
        if (lowEnergy - highEnergy > 6) {
            suggestions.push('Consider applying a high-pass filter on non-bass tracks to reduce low-end buildup');
        }
    }

    if (bands.highMid !== null && bands.mid !== null && bands.highMid - bands.mid > 6) {
        suggestions.push('Consider a gentle cut around 2–6 kHz on bright tracks to tame harshness');
    }

    // The healthy verdict requires measured evidence: a snapshot that found no
    // signal, or bands this analyser could not resolve, is never "good".
    if (issues.length === 0) {
        suggestions.push('Mix has good frequency balance and healthy levels');
    }

    return suggestions;
}
