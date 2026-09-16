import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getMasterAnalyser, getTrackStrip } from '#/modules/AudioEngine/useCases';

import {
    type MixEvidenceStatus,
    type MixIssue,
    SILENCE_FLOOR_DB,
    detectIssues,
    generateSuggestions,
    readFrequencyBalance,
    readLevels,
} from '../services/mixAnalysisHelpers';

export type AnalyzeMixOutput = {
    timestamp: number;
    /** Whether this snapshot carried enough program evidence to advise on, and where it came from. */
    status: MixEvidenceStatus;
    overallLevel: { peakDb: number; rmsDb: number };
    /** Per-band levels in dB; `null` marks a band this analyser cannot resolve. */
    frequencyBalance: {
        sub: number | null;
        bass: number | null;
        lowMid: number | null;
        mid: number | null;
        highMid: number | null;
        high: number | null;
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

/**
 * Decide whether this snapshot may produce a mix verdict. A suspended engine or
 * a master at the silence floor carried no program material, and advising on
 * silence produced the old "healthy mix" lie.
 */
function readEvidenceStatus(masterAnalyser: AnalyserNode, masterPeakDb: number): MixEvidenceStatus {
    const provenance = 'live-analyser-snapshot' as const;
    if (masterAnalyser.context.state !== 'running') {
        return { availability: 'insufficient', reason: 'audio-context-suspended', provenance };
    }
    if (masterPeakDb <= SILENCE_FLOOR_DB) {
        return { availability: 'insufficient', reason: 'no-signal', provenance };
    }
    return { availability: 'measured', provenance };
}

export async function analyzeMix(signal?: AbortSignal): Promise<AnalyzeMixOutput> {
    signal?.throwIfAborted();
    const masterAnalyser = getMasterAnalyser();
    const masterLevels = readLevels(masterAnalyser);
    const frequencyBalance = readFrequencyBalance(masterAnalyser);
    const status = readEvidenceStatus(masterAnalyser, masterLevels.peakDb);

    const tracks = getTrackStoreState()?.tracks ?? [];

    const trackLevels: AnalyzeMixOutput['trackLevels'] = [];

    for (const track of tracks) {
        signal?.throwIfAborted();
        if (track.kind === 'folder' || track.kind === 'master') {
            continue;
        }

        const strip = getTrackStrip(track.id);
        if (!strip) {
            continue;
        }

        const levels = readLevels(strip.analyserNode);

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

    const issues = detectIssues({ masterLevels, bands: frequencyBalance, trackLevels, status });

    // Frequency advice is only as good as the analyser's resolution. A coarse
    // meter FFT cannot attribute any bin to the lowest advertised bands; say so
    // explicitly instead of letting advice imply they were measured.
    if (frequencyBalance.sub === null || frequencyBalance.bass === null) {
        const binWidthHz = masterAnalyser.context.sampleRate / (masterAnalyser.frequencyBinCount * 2);
        issues.push({
            severity: 'info',
            category: 'frequency',
            message: `Low-frequency bands are unresolvable at this analyser's ${binWidthHz.toFixed(1)} Hz bin spacing — sub/bass advice was withheld`,
        });
    }

    const suggestions = generateSuggestions({
        masterLevels,
        bands: frequencyBalance,
        trackLevels,
        issues,
        status,
    });
    signal?.throwIfAborted();

    return {
        timestamp: Date.now(),
        status,
        overallLevel: masterLevels,
        frequencyBalance,
        trackLevels,
        issues,
        suggestions,
    };
}
