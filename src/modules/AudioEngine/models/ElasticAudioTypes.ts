export type TransientMarker = {
    id: string;
    /** Position in seconds (relative to clip start) */
    positionSec: number;
    /** Strength of the transient (0-1) */
    strength: number;
    /** Is this marker locked (won't move during quantize)? */
    locked: boolean;
};

export type ElasticAudioMode = 'polyphonic' | 'monophonic' | 'rhythmic' | 'x-form';

export type ElasticAudioState = {
    /** Detected transients per clip ID */
    transients: Map<string, TransientMarker[]>;
    /** Default quantize strength (0-1) */
    quantizeStrength: number;
    /** Grid subdivision for quantize */
    gridDivision: number;
    /** Processing mode */
    mode: ElasticAudioMode;
    /** Whether to preserve formants */
    preserveFormants: boolean;
};
