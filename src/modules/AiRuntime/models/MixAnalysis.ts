export type MixIssue = {
    severity: 'info' | 'warning' | 'critical';
    category: 'level' | 'frequency' | 'stereo' | 'dynamics';
    message: string;
    trackId?: string;
};

export type MixAnalysis = {
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
