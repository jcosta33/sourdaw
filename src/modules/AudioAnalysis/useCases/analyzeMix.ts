import { inject } from '#/infra/di/inject';
import { getMasterAnalyser } from '#/modules/AudioEngine/useCases/engineAccess';
import { getTrackStrip } from '#/modules/AudioEngine/useCases/trackAudioControls';
import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { readLevels, readFrequencyBalance } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { detectIssues, generateSuggestions } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';

// AudioAnalysis-local shape (AGENTS.md §95 — model isolation). Structurally
// compatible with AiRuntime's MixAnalysis; no cross-module model import.
type MixIssue = {
    severity: 'info' | 'warning' | 'critical';
    category: 'level' | 'frequency' | 'stereo' | 'dynamics';
    message: string;
    trackId?: string;
};

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

export const analyzeMix = inject({
    getMasterAnalyser,
    readLevels,
    readFrequencyBalance,
    detectIssues,
    generateSuggestions,
    getTrackStrip,
    getTrackStoreState,
})(
    ({
        getMasterAnalyser,
        readLevels,
        readFrequencyBalance,
        detectIssues,
        generateSuggestions,
        getTrackStrip,
        getTrackStoreState,
    }) =>
        async function analyzeMix(): Promise<AnalyzeMixOutput> {
            const masterAnalyser = getMasterAnalyser();
            const masterLevels = readLevels(masterAnalyser);
            const frequencyBalance = readFrequencyBalance(masterAnalyser);

            const state = getTrackStoreState();
            const tracks = state?.tracks ?? [];

            const trackLevels: AnalyzeMixOutput['trackLevels'] = [];

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
            const suggestions = generateSuggestions({
                masterLevels,
                bands: frequencyBalance,
                trackLevels,
                issues,
            });

            return {
                timestamp: Date.now(),
                overallLevel: masterLevels,
                frequencyBalance,
                trackLevels,
                issues,
                suggestions,
            };
        }
);
