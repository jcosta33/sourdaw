type MixAnalysisDisplayIssue = {
    severity: 'info' | 'warning' | 'critical';
    category: 'level' | 'frequency' | 'stereo' | 'dynamics';
    message: string;
    trackId?: string;
};

type MixAnalysisDisplayResult = {
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
    issues: MixAnalysisDisplayIssue[];
    suggestions: string[];
};

type CompleteMixAnalysisDisplayInput = {
    result: MixAnalysisDisplayResult;
};

export type MixAnalysisDisplayLifecycle = {
    begin: () => boolean;
    complete: (input: CompleteMixAnalysisDisplayInput) => void;
    fail: () => void;
};

const fallback_lifecycle: MixAnalysisDisplayLifecycle = {
    begin: () => false,
    complete: () => {},
    fail: () => {},
};

let configured_lifecycle = fallback_lifecycle;

export const mixAnalysisDisplayLifecycle: MixAnalysisDisplayLifecycle = {
    begin: () => configured_lifecycle.begin(),
    complete: (input) => {
        configured_lifecycle.complete(input);
    },
    fail: () => {
        configured_lifecycle.fail();
    },
};

export function setMixAnalysisDisplayLifecyclePort(lifecycle: MixAnalysisDisplayLifecycle): void {
    configured_lifecycle = lifecycle;
}
