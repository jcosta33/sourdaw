import { readSecondsAtBeat } from '#/modules/Transport/stores';

import { ANALYSIS_MEASURE_MAX_TARGETS } from '../models/AnalysisMeasureLimits';
import { type MeasurementWork } from '../models/MeasurementBudget';
import { type ProjectContext } from '../models/ProjectContext';
import { readAgentResourceLimits } from '../stores/agentResourceLimitsStore';

import { type MetricGoal } from './metricGoalContractTypes';
import { readMeasurementRenderedSeconds } from './readMeasurementRenderedSeconds';

type Range = NonNullable<MetricGoal['range']>;
type Metric = NonNullable<MetricGoal['metricId']>;
type Scope = { kind: 'master' } | { kind: 'tracks' | 'buses'; ids: string[] };
type Request = { prefix: string; scope: Scope; range: Range; metrics: Metric[] };

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

type UnitWork = MeasurementWork & { renderedSeconds: number };

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

function rangeKey(range: Range): string {
    return JSON.stringify([range.startBeat, range.endBeat, range.sectionId]);
}

function measuredSeconds(startBeat: number, endBeat: number): number {
    return readSecondsAtBeat({ beat: endBeat }) - readSecondsAtBeat({ beat: startBeat });
}

/**
 * Ranges grouped greedily by start so each group's span stays within the measured-seconds ceiling,
 * each group one render. A range that alone passes the ceiling keeps a group of its own, which the
 * render refuses as it would refuse that range.
 */
function groupRanges(reads: readonly MeasurementUnitRead[]): MeasurementRenderGroup[] {
    const ceiling = readAgentResourceLimits().measurementMeasuredSeconds;
    const ranges = [...new Map(reads.map((read) => [rangeKey(read.range), read.range])).values()].sort(
        (left, right) => left.startBeat - right.startBeat || left.endBeat - right.endBeat
    );
    const groups: MeasurementRenderGroup[] = [];
    for (const range of ranges) {
        const current = groups.at(-1);
        const endBeat = Math.max(current?.endBeat ?? range.endBeat, range.endBeat);
        if (current !== undefined && measuredSeconds(current.startBeat, endBeat) <= ceiling) {
            current.endBeat = endBeat;
            current.ranges.push(range);
            continue;
        }
        groups.push({ startBeat: range.startBeat, endBeat: range.endBeat, ranges: [range] });
    }
    return groups;
}

function scopeTargets(scope: Scope): string[] {
    return scope.kind === 'master' ? ['master'] : scope.ids;
}

function unitScope(kind: Scope['kind'], ids: string[]): Scope {
    return kind === 'master' ? { kind: 'master' } : { kind, ids };
}

/**
 * The units the requests render as. A `project` subject reads the live project: requests whose
 * scope holds the same targets join one unit over all their ranges. A `preview` subject reads the
 * prefix each request names beside the live project: one unit per target, over every prefix and
 * range any request reads it at. Measurement execution and whole-run admission both plan through
 * this, so what is admitted is what renders.
 */
export function planMetricMeasurementUnits(input: {
    requests: readonly Request[];
    subject: 'project' | 'preview';
}): MeasurementUnit[] {
    const units = new Map<string, { kind: Scope['kind']; ids: string[]; reads: MeasurementUnitRead[] }>();
    const join = (key: string, kind: Scope['kind'], ids: string[], read: MeasurementUnitRead) => {
        const unit = units.get(key) ?? { kind, ids, reads: [] };
        unit.reads.push(read);
        units.set(key, unit);
    };
    for (const [requestIndex, request] of input.requests.entries()) {
        const { scope, range, metrics } = request;
        if (input.subject === 'project') {
            const ids = scope.kind === 'master' ? [] : scope.ids;
            join(JSON.stringify([scope.kind, ids]), scope.kind, ids, { prefix: null, range, metrics, requestIndex });
            continue;
        }
        for (const targetId of scopeTargets(scope)) {
            const ids = scope.kind === 'master' ? [] : [targetId];
            join(JSON.stringify([scope.kind, targetId]), scope.kind, ids, {
                prefix: request.prefix,
                range,
                metrics,
                requestIndex,
            });
        }
    }
    return [...units.values()].map(({ kind, ids, reads }) => ({
        subject: input.subject,
        scope: unitScope(kind, ids),
        prefixes: input.subject === 'preview' ? [...new Set(reads.flatMap((read) => read.prefix ?? []))] : [],
        groups: groupRanges(reads),
        reads,
    }));
}

/** The prefix documents a preview unit renders in one group: each one read over a range the group covers. */
export function readGroupPrefixes(unit: MeasurementUnit, group: MeasurementRenderGroup): string[] {
    if (unit.subject === 'project') {
        return [];
    }
    const keys = new Set(group.ranges.map(rangeKey));
    return unit.prefixes.filter((prefix) =>
        unit.reads.some((read) => read.prefix === prefix && keys.has(rangeKey(read.range)))
    );
}

/**
 * What one unit spends: each target renders once per group in the live project plus once per
 * prefix document read in that group, and reduces once per read. `renderedSeconds` is the mean
 * seconds those renders process, so renders times it is the total the wall-clock allowance reads.
 */
export function countMeasurementUnitWork(unit: MeasurementUnit): UnitWork {
    const targets = scopeTargets(unit.scope).length;
    let renderJobs = 0;
    let processedSeconds = 0;
    for (const group of unit.groups) {
        const renders = targets * (1 + readGroupPrefixes(unit, group).length);
        renderJobs += renders;
        processedSeconds += renders * readMeasurementRenderedSeconds(group.endBeat);
    }
    return {
        renderJobs,
        analyses: targets * unit.reads.length,
        renderedSeconds: renderJobs === 0 ? 0 : processedSeconds / renderJobs,
    };
}

/** The renders and reductions a set of units spends, counted unit by unit. */
export function countMeasurementWork(units: readonly MeasurementUnit[]): MeasurementWork {
    return units.reduce(
        (total, unit) => {
            const work = countMeasurementUnitWork(unit);
            return { renderJobs: total.renderJobs + work.renderJobs, analyses: total.analyses + work.analyses };
        },
        { renderJobs: 0, analyses: 0 }
    );
}
