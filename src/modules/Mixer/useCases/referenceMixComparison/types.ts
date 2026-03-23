export type FrequencyBand = 'sub' | 'bass' | 'low-mid' | 'mid' | 'high-mid' | 'presence' | 'air';

export type MixAnalysis = {
    /** RMS level in dBFS */
    rmsDb: number;
    /** Peak level in dBFS */
    peakDb: number;
    /** Integrated loudness in LUFS */
    lufs: number;
    /** Frequency band energy distribution (0–1 for each band) */
    frequencyProfile: Record<FrequencyBand, number>;
    /** Stereo width (0 = mono, 1 = wide stereo) */
    stereoWidth: number;
    /** Dynamic range in dB */
    dynamicRange: number;
    /** Crest factor (peak-to-RMS ratio in dB) */
    crestFactor: number;
};

export type MixComparisonResult = {
    /** Overall similarity score (0–100) */
    overallScore: number;
    /** Category-specific scores */
    scores: {
        frequency: number;
        dynamics: number;
        loudness: number;
        stereoWidth: number;
    };
    /** Actionable suggestions */
    suggestions: MixSuggestion[];
    /** Reference analysis snapshot */
    referenceAnalysis: MixAnalysis;
    /** Current mix analysis snapshot */
    currentAnalysis: MixAnalysis;
    /** Timestamp */
    analyzedAt: string;
};

export type MixSuggestion = {
    category: 'frequency' | 'dynamics' | 'loudness' | 'stereo' | 'general';
    severity: 'info' | 'warning' | 'critical';
    message: string;
    /** Specific actionable fix */
    action: string;
    /** Which frequency band or parameter to adjust */
    target?: string;
    /** How much to adjust (in dB or %) */
    adjustment?: number;
};

export const FREQUENCY_RANGES: Record<FrequencyBand, [number, number]> = {
    sub: [20, 60],
    bass: [60, 250],
    'low-mid': [250, 500],
    mid: [500, 2000],
    'high-mid': [2000, 4000],
    presence: [4000, 8000],
    air: [8000, 20000],
};
