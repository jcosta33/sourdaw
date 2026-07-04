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
    token: number;
    result: MixAnalysisDisplayResult;
};

type FailMixAnalysisDisplayInput = {
    token: number;
};

export type MixAnalysisDisplayLifecycle = {
    begin: () => number | null;
    complete: (input: CompleteMixAnalysisDisplayInput) => void;
    fail: (input: FailMixAnalysisDisplayInput) => void;
};

const fallback_lifecycle: MixAnalysisDisplayLifecycle = {
    begin: () => null,
    complete: () => {},
    fail: () => {},
};

let configured_lifecycle = fallback_lifecycle;

export const mixAnalysisDisplayLifecycle: MixAnalysisDisplayLifecycle = {
    begin: () => configured_lifecycle.begin(),
    complete: (input) => {
        configured_lifecycle.complete(input);
    },
    fail: (input) => {
        configured_lifecycle.fail(input);
    },
};

export function setMixAnalysisDisplayLifecyclePort(lifecycle: MixAnalysisDisplayLifecycle): void {
    configured_lifecycle = lifecycle;
}
