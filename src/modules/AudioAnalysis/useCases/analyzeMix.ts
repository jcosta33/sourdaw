import { getMasterAnalyser } from '#/modules/AudioEngine/useCases/engineAccess';
import { getTrackStrip } from '#/modules/AudioEngine/useCases/trackAudioControls';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { readLevels, readFrequencyBalance } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { detectIssues, generateSuggestions } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { type MixAnalysis } from '#/modules/AiRuntime/models/MixAnalysis';

// Re-export model types and formatMixAnalysis for consumers
export type { MixAnalysis, MixIssue } from '#/modules/AiRuntime/models/MixAnalysis';

export type AnalyzeMixOutput = MixAnalysis;

export async function analyzeMix(): Promise<AnalyzeMixOutput> {
    const masterAnalyser = getMasterAnalyser();
    const masterLevels = readLevels(masterAnalyser);
    const frequencyBalance = readFrequencyBalance(masterAnalyser);

    const state = trackStore.value;
    const tracks = state?.tracks ?? [];

    const trackLevels: MixAnalysis['trackLevels'] = [];

    for (const track of tracks) {
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
    const suggestions = generateSuggestions({ masterLevels, bands: frequencyBalance, trackLevels, issues });

    return {
        timestamp: Date.now(),
        overallLevel: masterLevels,
        frequencyBalance,
        trackLevels,
        issues,
        suggestions,
    };
}
