import { ANALYSIS_MEASURE_MAX_TARGETS } from '../models/AnalysisMeasureLimits';
import { type ProjectContext } from '../models/ProjectContext';

import { type MetricGoal } from './metricGoalContractTypes';

export type MeasurementRange = NonNullable<MetricGoal['range']>;
export type MeasurementMetric = NonNullable<MetricGoal['metricId']>;
export type MeasurementScope = { kind: 'master' } | { kind: 'tracks' | 'buses'; ids: string[] };
/** One receipt's worth of reads: one prefix, scope and exact range, over these metrics. */
export type MeasurementRequest = {
    prefix: string;
    scope: MeasurementScope;
    range: MeasurementRange;
    metrics: MeasurementMetric[];
};
type Range = MeasurementRange;
type Metric = MeasurementMetric;
type Scope = MeasurementScope;
type Request = MeasurementRequest;

/** One range a unit reduces, at one document (`null` for the live project alone), and the receipt it reports in. */
export type MeasurementUnitRead = { prefix: string | null; range: Range; metrics: Metric[]; requestIndex: number };

/** Ranges one render covers: its span fits each measurement's measured-seconds ceiling. */
export type MeasurementRenderGroup = { startBeat: number; endBeat: number; ranges: Range[] };

/**
 * The work rendered together: each target of `scope` renders once per group in the live project
 * and, for a preview, once per group in each prefix document read there; each read is one
 * reduction per target, of that range's window. A project unit holds up to
 * `ANALYSIS_MEASURE_MAX_TARGETS` targets read over the same ranges; a preview unit holds one target,
 * so its live render serves every prefix and range it is read at while the buffers it holds stay
 * those of one target.
 */
export type MeasurementUnit = {
    subject: 'project' | 'preview';
    scope: Scope;
    /** Prefix documents a preview unit renders, in first-read order; empty for a project unit. */
    prefixes: string[];
    groups: MeasurementRenderGroup[];
    reads: MeasurementUnitRead[];
};

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

/**
 * The receipts a measurement reports in: reads grouped by prefix, scope kind and exact range, at most
 * `ANALYSIS_MEASURE_MAX_TARGETS` targets each. `planMetricMeasurementUnits` says how they render.
 */
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
