/** Retained by the session for teardown and completed-coverage inspection. */
export type LoopAudioScheduleLifetime = {
    reset: () => void;
    readonly active: boolean;
    readonly coverage: {
        from: number;
        through: number;
        target: number;
        completionAudioTime: number;
        windows: number;
        shortfall:
            | 'pass-budget'
            | 'time-budget'
            | 'unrepresentable'
            | 'media-unavailable'
            | 'retired'
            | 'coverage-expired'
            | 'noncanonical-frozen-window'
            | null;
    };
};
