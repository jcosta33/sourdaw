import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";
import { trackStore } from "#/modules/Track/stores/trackStore";

export type MixIssue = {
    severity: "info" | "warning" | "critical";
    category: "level" | "frequency" | "stereo" | "dynamics";
    message: string;
    trackId?: string;
};

export type MixAnalysisResult = {
    timestamp: number;
    overallLevel: { peakDb: number; rmsDb: number };
    frequencyBalance: {
        sub: number;
        bass: number;
        lowMid: number;
        mid: number;
        highMid: number;
        high: number;
    };
    trackLevels: Array<{
        trackId: string;
        trackName: string;
        peakDb: number;
        rmsDb: number;
        isMuted: boolean;
        isSoloed: boolean;
        isClipping: boolean;
    }>;
    issues: MixIssue[];
    suggestions: string[];
};

const SILENCE_FLOOR_DB = -100;

const linearToDb = (linear: number): number => {
    if (linear <= 0) {
        return SILENCE_FLOOR_DB;
    }
    return 20 * Math.log10(linear);
};

type FrequencyBands = MixAnalysisResult["frequencyBalance"];

const BAND_RANGES: Array<{ key: keyof FrequencyBands; low: number; high: number }> = [
    { key: "sub", low: 20, high: 60 },
    { key: "bass", low: 60, high: 250 },
    { key: "lowMid", low: 250, high: 500 },
    { key: "mid", low: 500, high: 2000 },
    { key: "highMid", low: 2000, high: 6000 },
    { key: "high", low: 6000, high: 20000 },
];

const computeFrequencyBalance = (analyser: AnalyserNode): FrequencyBands => {
    const binCount = analyser.frequencyBinCount;
    const data = new Float32Array(binCount);
    analyser.getFloatFrequencyData(data);

    const sampleRate = analyser.context.sampleRate;
    const binWidth = sampleRate / (binCount * 2);

    const bands: FrequencyBands = { sub: SILENCE_FLOOR_DB, bass: SILENCE_FLOOR_DB, lowMid: SILENCE_FLOOR_DB, mid: SILENCE_FLOOR_DB, highMid: SILENCE_FLOOR_DB, high: SILENCE_FLOOR_DB };

    for (const { key, low, high } of BAND_RANGES) {
        const startBin = Math.max(1, Math.floor(low / binWidth));
        const endBin = Math.min(binCount - 1, Math.ceil(high / binWidth));

        let sum = 0;
        let count = 0;
        for (let i = startBin; i <= endBin; i++) {
            const dbVal = data[i] ?? SILENCE_FLOOR_DB;
            sum += Math.pow(10, dbVal / 10);
            count++;
        }

        if (count > 0) {
            bands[key] = 10 * Math.log10(sum / count);
        }
    }

    return bands;
};

const computeLevels = (analyser: AnalyserNode): { peakDb: number; rmsDb: number } => {
    const data = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatTimeDomainData(data);

    let peak = 0;
    let sumSquares = 0;

    for (let i = 0; i < data.length; i++) {
        const sample = data[i]!;
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
};

const detectIssues = (
    masterLevels: { peakDb: number; rmsDb: number },
    bands: FrequencyBands,
    trackLevels: MixAnalysisResult["trackLevels"],
): MixIssue[] => {
    const issues: MixIssue[] = [];

    for (const tl of trackLevels) {
        if (tl.isClipping) {
            issues.push({
                severity: "critical",
                category: "level",
                message: `${tl.trackName} is clipping at ${tl.peakDb.toFixed(1)} dB`,
                trackId: tl.trackId,
            });
        }
    }

    if (masterLevels.peakDb > -3) {
        issues.push({
            severity: "warning",
            category: "level",
            message: `Master peak is ${masterLevels.peakDb.toFixed(1)} dB — low headroom`,
        });
    }

    const lowEnergy = (bands.sub + bands.bass) / 2;
    const highEnergy = (bands.mid + bands.high) / 2;
    if (lowEnergy - highEnergy > 6) {
        issues.push({
            severity: "warning",
            category: "frequency",
            message: `Mix is muddy — low-end energy exceeds mids/highs by ${(lowEnergy - highEnergy).toFixed(1)} dB`,
        });
    }

    if (bands.highMid - bands.mid > 6) {
        issues.push({
            severity: "warning",
            category: "frequency",
            message: `Mix is harsh — high-mid energy exceeds mids by ${(bands.highMid - bands.mid).toFixed(1)} dB`,
        });
    }

    for (const tl of trackLevels) {
        if (tl.isMuted) {
            issues.push({
                severity: "info",
                category: "level",
                message: `${tl.trackName} is muted`,
                trackId: tl.trackId,
            });
        }
    }

    const activeTracks = trackLevels.filter((t) => !t.isMuted && t.peakDb > SILENCE_FLOOR_DB);
    if (activeTracks.length >= 2) {
        const peaks = activeTracks.map((t) => t.peakDb);
        const maxPeak = Math.max(...peaks);
        const minPeak = Math.min(...peaks);
        if (maxPeak - minPeak > 20) {
            const loudest = activeTracks.find((t) => t.peakDb === maxPeak);
            const quietest = activeTracks.find((t) => t.peakDb === minPeak);
            issues.push({
                severity: "info",
                category: "level",
                message: `Track levels differ by ${(maxPeak - minPeak).toFixed(1)} dB (${loudest?.trackName} vs ${quietest?.trackName})`,
            });
        }
    }

    return issues;
};

const generateSuggestions = (
    masterLevels: { peakDb: number; rmsDb: number },
    bands: FrequencyBands,
    trackLevels: MixAnalysisResult["trackLevels"],
    issues: MixIssue[],
): string[] => {
    const suggestions: string[] = [];

    for (const tl of trackLevels) {
        if (tl.isClipping) {
            const overshoot = tl.peakDb + 0.5;
            suggestions.push(`${tl.trackName} is clipping — reduce gain by at least ${overshoot.toFixed(1)} dB`);
        }
    }

    if (masterLevels.peakDb > -3) {
        const reduction = masterLevels.peakDb + 6;
        suggestions.push(`Master is hot at ${masterLevels.peakDb.toFixed(1)} dB — reduce by ${reduction.toFixed(1)} dB to leave headroom for mastering`);
    }

    const lowEnergy = (bands.sub + bands.bass) / 2;
    const highEnergy = (bands.mid + bands.high) / 2;
    if (lowEnergy - highEnergy > 6) {
        suggestions.push("Consider applying a high-pass filter on non-bass tracks to reduce low-end buildup");
    }

    if (bands.highMid - bands.mid > 6) {
        suggestions.push("Consider a gentle cut around 2–6 kHz on bright tracks to tame harshness");
    }

    if (issues.length === 0) {
        suggestions.push("Mix has good frequency balance and healthy levels");
    }

    return suggestions;
};

export const analyzeMix = async (): Promise<MixAnalysisResult> => {
    const masterAnalyser = audioEngine.masterAnalyser;
    const masterLevels = computeLevels(masterAnalyser);
    const frequencyBalance = computeFrequencyBalance(masterAnalyser);

    const state = trackStore.value;
    const tracks = state?.tracks ?? [];

    const trackLevels: MixAnalysisResult["trackLevels"] = [];

    for (const track of tracks) {
        if (track.kind === "folder" || track.kind === "master") {
            continue;
        }

        const strip = audioEngine.getTrackStrip(track.id);
        if (!strip) {
            continue;
        }

        const levels = computeLevels(strip.analyserNode);

        trackLevels.push({
            trackId: track.id,
            trackName: track.name,
            peakDb: levels.peakDb,
            rmsDb: levels.rmsDb,
            isMuted: strip.muted,
            isSoloed: strip.soloed,
            isClipping: levels.peakDb > -0.5,
        });
    }

    const issues = detectIssues(masterLevels, frequencyBalance, trackLevels);
    const suggestions = generateSuggestions(masterLevels, frequencyBalance, trackLevels, issues);

    return {
        timestamp: Date.now(),
        overallLevel: masterLevels,
        frequencyBalance,
        trackLevels,
        issues,
        suggestions,
    };
};

export const formatMixAnalysis = (result: MixAnalysisResult): string => {
    const lines: string[] = [];

    lines.push("=== Mix Analysis ===");
    lines.push(`Master: peak ${result.overallLevel.peakDb.toFixed(1)} dB, RMS ${result.overallLevel.rmsDb.toFixed(1)} dB`);
    lines.push("");

    lines.push("Frequency Balance:");
    lines.push(`  Sub  (20–60 Hz):     ${result.frequencyBalance.sub.toFixed(1)} dB`);
    lines.push(`  Bass (60–250 Hz):    ${result.frequencyBalance.bass.toFixed(1)} dB`);
    lines.push(`  Low-Mid (250–500):   ${result.frequencyBalance.lowMid.toFixed(1)} dB`);
    lines.push(`  Mid (500–2k):        ${result.frequencyBalance.mid.toFixed(1)} dB`);
    lines.push(`  High-Mid (2k–6k):    ${result.frequencyBalance.highMid.toFixed(1)} dB`);
    lines.push(`  High (6k–20k):       ${result.frequencyBalance.high.toFixed(1)} dB`);
    lines.push("");

    if (result.trackLevels.length > 0) {
        lines.push("Track Levels:");
        for (const tl of result.trackLevels) {
            const flags = [
                tl.isMuted ? "MUTED" : null,
                tl.isSoloed ? "SOLO" : null,
                tl.isClipping ? "CLIP!" : null,
            ].filter(Boolean).join(" ");
            lines.push(`  ${tl.trackName}: peak ${tl.peakDb.toFixed(1)} dB, RMS ${tl.rmsDb.toFixed(1)} dB ${flags}`);
        }
        lines.push("");
    }

    if (result.issues.length > 0) {
        lines.push("Issues:");
        for (const issue of result.issues) {
            const icon = issue.severity === "critical" ? "[!]" : issue.severity === "warning" ? "[~]" : "[i]";
            lines.push(`  ${icon} ${issue.message}`);
        }
        lines.push("");
    }

    if (result.suggestions.length > 0) {
        lines.push("Suggestions:");
        for (const s of result.suggestions) {
            lines.push(`  • ${s}`);
        }
    }

    return lines.join("\n");
};
