import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';

import { ANALYSIS_MEASURE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { ANALYSIS_MEASURE_MAX_ID_LENGTH, ANALYSIS_MEASURE_MAX_TARGETS } from '../models/AnalysisMeasureLimits';

type AgentMeasurementMetricId = ReturnType<typeof getAgentMeasurementMetricIds>[number];

type AnalysisMeasureScope = { kind: 'master' | 'project' } | { kind: 'tracks' | 'buses'; ids: string[] };

type AnalysisMeasureRange = { sectionId: string } | { startBeat: number; endBeat: number };

/**
 * What is measured: the project as it stands, or the project with a proposed semantic command list
 * applied in isolation, beside the project itself. The list is validated by the compiler a
 * proposal uses, not here.
 */
type AnalysisMeasureSubject = { kind: 'project' } | { kind: 'preview'; proposal: Readonly<Record<string, unknown>> };

type AnalysisMeasureArguments = {
    scope: AnalysisMeasureScope;
    range: AnalysisMeasureRange;
    /** The requested metrics in receipt key order; every metric when the call names none. */
    metrics: AgentMeasurementMetricId[];
    subject: AnalysisMeasureSubject;
};

type ParsedAnalysisMeasureArguments =
    { status: 'valid'; value: AnalysisMeasureArguments } | { status: 'invalid'; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
    return Object.keys(value).every((key) => allowed.includes(key));
}

function isBoundedId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= ANALYSIS_MEASURE_MAX_ID_LENGTH;
}

function isBeat(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseTargetIds(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > ANALYSIS_MEASURE_MAX_TARGETS) {
        return null;
    }
    const ids: string[] = [];
    for (const entry of value) {
        if (!isBoundedId(entry) || ids.includes(entry)) {
            return null;
        }
        ids.push(entry);
    }
    return ids;
}

function parseScope(value: unknown): AnalysisMeasureScope | null {
    if (!isRecord(value) || !hasOnlyKeys(value, ['kind', 'ids'])) {
        return null;
    }
    if (value.kind === 'master' || value.kind === 'project') {
        return value.ids === undefined ? { kind: value.kind } : null;
    }
    if (value.kind !== 'tracks' && value.kind !== 'buses') {
        return null;
    }
    const ids = parseTargetIds(value.ids);
    return ids === null ? null : { kind: value.kind, ids };
}

function parseRange(value: unknown): AnalysisMeasureRange | null {
    if (!isRecord(value) || !hasOnlyKeys(value, ['sectionId', 'startBeat', 'endBeat'])) {
        return null;
    }
    if (value.sectionId !== undefined) {
        const bySectionOnly = value.startBeat === undefined && value.endBeat === undefined;
        return bySectionOnly && isBoundedId(value.sectionId) ? { sectionId: value.sectionId } : null;
    }
    if (!isBeat(value.startBeat) || !isBeat(value.endBeat)) {
        return null;
    }
    return { startBeat: value.startBeat, endBeat: value.endBeat };
}

function parseMetrics(value: unknown): AgentMeasurementMetricId[] | null {
    const metricIds = getAgentMeasurementMetricIds();
    if (value === undefined) {
        return [...metricIds];
    }
    if (!Array.isArray(value) || value.length === 0) {
        return null;
    }
    const requested = new Set<unknown>(value);
    if (requested.size !== value.length || value.some((entry) => !metricIds.some((id) => id === entry))) {
        return null;
    }
    return metricIds.filter((id) => requested.has(id));
}

function parseSubject(subject: unknown, proposal: unknown): AnalysisMeasureSubject | null {
    if (subject === undefined || subject === 'project') {
        return proposal === undefined ? { kind: 'project' } : null;
    }
    if (subject === 'preview' && isRecord(proposal)) {
        return { kind: 'preview', proposal };
    }
    return null;
}

/**
 * The strict argument contract of one `analysis.measure` call.
 *
 * Only the argument shape is decided here. Whether a range's start precedes its
 * end, whether a section or target exists, and whether the range fits the
 * render ceilings are answered by the executor against the project.
 *
 * `toolName` is the tool the refusals name: `analysis.compareReference` takes the same
 * scope, range and metrics, so it reads them through this contract.
 */
export function parseAnalysisMeasureArguments(
    argumentsValue: unknown,
    toolName: string = ANALYSIS_MEASURE_TOOL_NAME
): ParsedAnalysisMeasureArguments {
    if (
        !isRecord(argumentsValue) ||
        !hasOnlyKeys(argumentsValue, ['scope', 'range', 'metrics', 'subject', 'proposal'])
    ) {
        return {
            status: 'invalid',
            reason: `${toolName} accepts only scope, range, metrics, subject and proposal.`,
        };
    }
    const subject = parseSubject(argumentsValue.subject, argumentsValue.proposal);
    if (subject === null) {
        return {
            status: 'invalid',
            reason: `${toolName} subject is project, which takes no proposal, or preview, which requires a proposal list.`,
        };
    }
    const scope = parseScope(argumentsValue.scope);
    if (scope === null) {
        return {
            status: 'invalid',
            reason: `${toolName} scope must be master, project, or tracks or buses with 1 to ${String(ANALYSIS_MEASURE_MAX_TARGETS)} distinct ids.`,
        };
    }
    const range = parseRange(argumentsValue.range);
    if (range === null) {
        return {
            status: 'invalid',
            reason: `${toolName} range must be a sectionId alone, or finite non-negative startBeat and endBeat.`,
        };
    }
    const metrics = parseMetrics(argumentsValue.metrics);
    if (metrics === null) {
        return {
            status: 'invalid',
            reason: `${toolName} metrics must be a non-empty list of distinct measurement metric ids.`,
        };
    }
    return { status: 'valid', value: { scope, range, metrics, subject } };
}
