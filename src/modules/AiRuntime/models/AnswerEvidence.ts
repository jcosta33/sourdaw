import { type compareAgentScopeMeasurements } from '#/modules/AudioAnalysis/useCases';

import { type AnswerMetricId } from './AnswerInterpretation';

/** Typed projection minted by the successful project-measurement producer, never parsed from provider data. */
export type AnswerMeasurement = {
    revision: string;
    scope: { kind: 'project' | 'master' } | { kind: 'tracks' | 'buses'; ids: readonly string[] };
    range: { startBeat: number; endBeat: number; sectionId: string | null };
    metrics: readonly AnswerMetricId[];
    targets: readonly {
        targetId: string;
        targetKind: 'master' | 'track' | 'bus';
        route: 'mixdown' | 'isolated-subgraph';
        artifact: { contentAddress: string };
        measurements: Parameters<typeof compareAgentScopeMeasurements>[0]['baseline'];
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
