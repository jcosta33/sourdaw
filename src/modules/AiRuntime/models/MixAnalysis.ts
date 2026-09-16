export type MixIssue = {
    severity: 'info' | 'warning' | 'critical';
    category: 'level' | 'frequency' | 'stereo' | 'dynamics';
    message: string;
    trackId?: string;
};

/**
 * Whether the analysis snapshot carried enough program evidence to advise on.
 * An insufficient measurement never counts as a healthy mix.
 */
export type MixEvidenceStatus =
    | { availability: 'measured'; provenance: 'live-analyser-snapshot' }
    | {
          availability: 'insufficient';
          reason: 'audio-context-suspended' | 'no-signal';
          provenance: 'live-analyser-snapshot';
      };

export type MixAnalysis = {
    timestamp: number;
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
