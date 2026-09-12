/**
 * Evidence that the audio callback met — or missed — its deadline, separated by
 * the observer that saw it.
 *
 * Each category is a discriminated union rather than a number, because a
 * platform with no observer for a category has no figure to report and a zero
 * there would read as a clean bill of health. An `unavailable` reading carries
 * no `events` field at all, so a consumer cannot reach a count that was never
 * measured; it has to handle the absence of coverage explicitly.
 */
export type DeadlineCategoryReading =
    { coverage: 'observed'; events: number } | { coverage: 'unavailable'; reason: string };

/**
 * The load the reading was taken under. A dropout count means nothing on its
 * own: the same figure is healthy at 2048 frames on four tracks and a failure
 * at 64 frames on the same four.
 *
 * The two carriers run together and open their outputs at their own rates, so
 * each keeps its own entry rather than sharing one flattened figure that would
 * pair one engine's rate with the other's counts. A null entry means that
 * carrier is not running, the same reading rule `unavailable` carries: never a
 * zero standing in for a figure nobody produced.
 */
export type AudioDeadlineWorkload = {
    webEngine: { sampleRate: number } | null;
    nativeEngine: { sampleRate: number; outputBufferFrames: number } | null;
    trackCount: number;
    transport: 'stopped' | 'playing' | 'recording';
};

export type AudioDeadlineEvidence = {
    version: 1;
    workload: AudioDeadlineWorkload;
    engineUnderruns: DeadlineCategoryReading;
    nativeStreamFaults: DeadlineCategoryReading;
    mainThreadLongTasks: DeadlineCategoryReading;
    loopbackDiscontinuities: DeadlineCategoryReading;
};
