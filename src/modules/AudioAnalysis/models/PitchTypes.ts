export type PitchResult = {
    timeSec: number;
    frequency: number;
    midiPitch: number;
    noteName: string;
    clarity: number;
};

export type PitchTrackingOptions = {
    /** Window size in samples for each pitch estimate (default 2048) */
    windowSize?: number;
    /** Hop size in samples between windows (default 512) */
    hopSize?: number;
    /** Minimum clarity threshold 0-1 to include a pitch (default 0.8) */
    clarityThreshold?: number;
    /** Minimum volume in dB to include a pitch (default -40) */
    minVolumeDb?: number;
};
