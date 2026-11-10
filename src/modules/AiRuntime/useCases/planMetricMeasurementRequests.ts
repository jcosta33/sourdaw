import { ANALYSIS_MEASURE_MAX_TARGETS } from '../models/AnalysisMeasureLimits';
import { type ProjectContext } from '../models/ProjectContext';

import { type MetricGoal } from './metricGoalContractTypes';

type Range = NonNullable<MetricGoal['range']>;
type Metric = NonNullable<MetricGoal['metricId']>;
type Scope = { kind: 'master' } | { kind: 'tracks' | 'buses'; ids: string[] };
type Request = { prefix: string; scope: Scope; range: Range; metrics: Metric[] };

function belongsToScope(targetId: string, kind: Scope['kind'], context: Pick<ProjectContext, 'tracks'>): boolean {
    if (targetId === 'master') {
        return kind === 'master';
    }
    const track = context.tracks.find((candidate) => candidate.id === targetId);
    if (kind === 'buses') {
        return track?.kind === 'bus';
    }
    return kind === 'tracks' && (track?.kind === 'audio' || track?.kind === 'midi');
}

/** Shared request matrix for actual preview execution and complete-run admission. */
export function planMetricMeasurementRequests(input: {
    reads: readonly { prefix: string; range: Range; metricId: Metric; targetIds: readonly string[] }[];
    context: Pick<ProjectContext, 'tracks'>;
}): Request[] {
    const groups = new Map<
        string,
        { prefix: string; kind: Scope['kind']; range: Range; metrics: Map<string, Set<Metric>> }
    >();
    for (const read of input.reads) {
        for (const kind of ['master', 'tracks', 'buses'] as const) {
            for (const targetId of read.targetIds) {
                if (!belongsToScope(targetId, kind, input.context)) {
                    continue;
                }
                const key = JSON.stringify([
                    read.prefix,
                    kind,
                    read.range.startBeat,
                    read.range.endBeat,
                    read.range.sectionId,
                ]);
                let group = groups.get(key);
                if (group === undefined) {
                    group = { prefix: read.prefix, kind, range: read.range, metrics: new Map() };
                    groups.set(key, group);
                }
                const metrics = group.metrics.get(targetId) ?? new Set<Metric>();
                metrics.add(read.metricId);
                group.metrics.set(targetId, metrics);
            }
        }
    }
    const requests: Request[] = [];
    for (const group of groups.values()) {
        const ids = [...group.metrics.keys()];
        for (let offset = 0; offset < ids.length; offset += ANALYSIS_MEASURE_MAX_TARGETS) {
            const chunk = ids.slice(offset, offset + ANALYSIS_MEASURE_MAX_TARGETS);
            const metrics = [...new Set(chunk.flatMap((id) => Array.from(group.metrics.get(id) ?? [])))];
            requests.push({
                prefix: group.prefix,
                scope: group.kind === 'master' ? { kind: 'master' } : { kind: group.kind, ids: chunk },
                range: group.range,
                metrics,
            });
        }
    }
    return requests;
}
