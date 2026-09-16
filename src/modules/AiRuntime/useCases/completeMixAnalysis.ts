import { isCurrentMixAnalysisRun } from '../stores/mixAnalysisRunRegistry';
import { mixAnalysisStore } from '../stores/mixAnalysisStore';

type CompleteMixAnalysisInput = {
    token: number;
    result: {
        timestamp: number;
        status:
            | { availability: 'measured'; provenance: 'live-analyser-snapshot' }
            | {
                  availability: 'insufficient';
                  reason: 'audio-context-suspended' | 'no-signal';
                  provenance: 'live-analyser-snapshot';
              };
        overallLevel: { peakDb: number; rmsDb: number };
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
        issues: Array<{
            severity: 'info' | 'warning' | 'critical';
            category: 'level' | 'frequency' | 'stereo' | 'dynamics';
            message: string;
            trackId?: string;
        }>;
        suggestions: string[];
    };
};

export function completeMixAnalysis(input: CompleteMixAnalysisInput): void {
    if (!isCurrentMixAnalysisRun(input.token)) {
        return;
    }

    mixAnalysisStore.update((state) => {
        if (!state) {
            return {
                result: input.result,
                isAnalyzing: false,
                panelOpen: true,
            };
        }

        return {
            ...state,
            result: input.result,
            isAnalyzing: false,
            panelOpen: true,
        };
    });
}
