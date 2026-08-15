import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getMasterAnalyser, getTrackStrip } from '#/modules/AudioEngine/useCases';

import {
    type MixIssue,
    detectIssues,
    generateSuggestions,
    readFrequencyBalance,
    readLevels,
} from '../services/mixAnalysisHelpers';

export type AnalyzeMixOutput = {
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

// eslint-disable-next-line @typescript-eslint/require-await -- async API contract; callers await this; will be async when real DSP analysis is added
export async function analyzeMix(signal?: AbortSignal): Promise<AnalyzeMixOutput> {
    signal?.throwIfAborted();
    const masterAnalyser = getMasterAnalyser();
    const masterLevels = readLevels(masterAnalyser);
    const frequencyBalance = readFrequencyBalance(masterAnalyser);

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

    const issues = detectIssues({ masterLevels, bands: frequencyBalance, trackLevels });
    const suggestions = generateSuggestions({
        masterLevels,
        bands: frequencyBalance,
        trackLevels,
        issues,
    });
    signal?.throwIfAborted();

    return {
        timestamp: Date.now(),
        overallLevel: masterLevels,
        frequencyBalance,
        trackLevels,
        issues,
        suggestions,
    };
}
