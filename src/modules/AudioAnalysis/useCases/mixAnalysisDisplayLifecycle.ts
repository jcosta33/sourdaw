type MixAnalysisDisplayIssue = {
    severity: 'info' | 'warning' | 'critical';
    category: 'level' | 'frequency' | 'stereo' | 'dynamics';
    message: string;
    trackId?: string;
};

type MixAnalysisDisplayEvidenceStatus =
    | { availability: 'measured'; provenance: 'live-analyser-snapshot' }
    | {
          availability: 'insufficient';
          reason: 'audio-context-suspended' | 'no-signal';
          provenance: 'live-analyser-snapshot';
      };

type MixAnalysisDisplayResult = {
    timestamp: number;
    status: MixAnalysisDisplayEvidenceStatus;
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

let registeredLifecycle: MixAnalysisDisplayLifecycle | null = null;

function registered(member: keyof MixAnalysisDisplayLifecycle): MixAnalysisDisplayLifecycle {
    if (registeredLifecycle === null) {
        throw new Error(
            `mixAnalysisDisplayLifecycle.${member}: the mix analysis display lifecycle is not registered; call setMixAnalysisDisplayLifecycle() from #/app/bootstrap (bootstrap does this)`
        );
    }
    return registeredLifecycle;
}

export const mixAnalysisDisplayLifecycle: MixAnalysisDisplayLifecycle = {
    begin: () => registered('begin').begin(),
    complete: (input) => {
        registered('complete').complete(input);
    },
    fail: (input) => {
        registered('fail').fail(input);
    },
};

export function setMixAnalysisDisplayLifecyclePort(lifecycle: MixAnalysisDisplayLifecycle): void {
    registeredLifecycle = lifecycle;
}
