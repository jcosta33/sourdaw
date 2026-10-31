/** Typed projection minted by the successful project-measurement producer, never parsed from provider data. */
export type AnswerMeasurement<MetricId extends string, Measurements> = {
    revision: string;
    scope: { kind: 'project' | 'master' } | { kind: 'tracks' | 'buses'; ids: readonly string[] };
    range: { startBeat: number; endBeat: number; sectionId: string | null };
    metrics: readonly MetricId[];
    targets: readonly {
        targetId: string;
        targetKind: 'master' | 'track' | 'bus';
        route: 'mixdown' | 'isolated-subgraph';
        artifact: { contentAddress: string };
        measurements: Measurements;
    }[];
};
export type AnswerOnsets = {
    clipId: string;
    sourceRevisionDigest: string;
    timeAxis: 'source-buffer';
    totalHitCount: number;
    coverage: { offset: number; endOffset: number };
    hits: readonly { sourceSeconds: number; confidence: number }[];
};
