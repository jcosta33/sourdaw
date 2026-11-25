import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';

import { ANALYSIS_MEASURE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import {
    ANALYSIS_MEASURE_MAX_ID_LENGTH,
    ANALYSIS_MEASURE_MAX_PREVIEW_RECIPES,
    ANALYSIS_MEASURE_MAX_TARGETS,
} from '../models/AnalysisMeasureLimits';

type AgentMeasurementMetricId = ReturnType<typeof getAgentMeasurementMetricIds>[number];

type AnalysisMeasureScope = { kind: 'master' | 'project' } | { kind: 'tracks' | 'buses'; ids: string[] };

type AnalysisMeasureRange = { sectionId: string } | { startBeat: number; endBeat: number };

/**
 * What is measured: the project as it stands, or a semantic list or one or more retained recipe
 * expansions applied in isolation beside it, several expansions as one cumulative batch. A single
 * `recipeCallId` reads as a list of one. The executor validates commands through proposal admission.
 */
type AnalysisMeasureSubject =
    | { kind: 'project' }
    | { kind: 'preview'; proposal: Readonly<Record<string, unknown>> }
    | { kind: 'preview'; recipeCallIds: readonly string[] };

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

function parseTargetIds(value: unknown, maxTargets: number): string[] | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > maxTargets) {
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

function parseScope(value: unknown, maxTargets: number): AnalysisMeasureScope | null {
    if (!isRecord(value) || !hasOnlyKeys(value, ['kind', 'ids'])) {
        return null;
    }
    if (value.kind === 'master' || value.kind === 'project') {
        return value.ids === undefined ? { kind: value.kind } : null;
    }
    if (value.kind !== 'tracks' && value.kind !== 'buses') {
        return null;
    }
    const ids = parseTargetIds(value.ids, maxTargets);
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

type ParsedSubject = { status: 'valid'; subject: AnalysisMeasureSubject } | { status: 'invalid'; reason: string };

/** The recipe call ids a preview names, in the order given; the executor orders them as the planner's steps. */
function parseRecipeCallIds(value: unknown, toolName: string): ParsedSubject {
    if (!Array.isArray(value) || value.length === 0) {
        return { status: 'invalid', reason: `${toolName} recipeCallIds must list at least one recipe call id.` };
    }
    if (value.length > ANALYSIS_MEASURE_MAX_PREVIEW_RECIPES) {
        return {
            status: 'invalid',
            reason: `${toolName} recipeCallIds holds at most ${String(ANALYSIS_MEASURE_MAX_PREVIEW_RECIPES)} recipe call ids.`,
        };
    }
    const ids = value.filter(isBoundedId);
    if (ids.length !== value.length) {
        return {
            status: 'invalid',
            reason: `${toolName} recipeCallIds entries must be non-empty call ids of at most ${String(ANALYSIS_MEASURE_MAX_ID_LENGTH)} characters.`,
        };
    }
    const duplicate = ids.find((entry, index) => ids.indexOf(entry) !== index);
    if (duplicate !== undefined) {
        return { status: 'invalid', reason: `${toolName} recipeCallIds names "${duplicate}" more than once.` };
    }
    return { status: 'valid', subject: { kind: 'preview', recipeCallIds: ids } };
}

function parseSubject(argumentsValue: Record<string, unknown>, toolName: string): ParsedSubject {
    const { subject, proposal, recipeCallId, recipeCallIds } = argumentsValue;
    const sources = [proposal, recipeCallId, recipeCallIds].filter((source) => source !== undefined).length;
    const invalid: ParsedSubject = {
        status: 'invalid',
        reason: `${toolName} subject is project, which takes no source, or preview, which requires exactly one of proposal, recipeCallId or recipeCallIds.`,
    };
    if (subject === undefined || subject === 'project') {
        return sources === 0 ? { status: 'valid', subject: { kind: 'project' } } : invalid;
    }
    if (subject !== 'preview' || sources !== 1) {
        return invalid;
    }
    if (isRecord(proposal)) {
        return { status: 'valid', subject: { kind: 'preview', proposal } };
    }
    if (isBoundedId(recipeCallId)) {
        return { status: 'valid', subject: { kind: 'preview', recipeCallIds: [recipeCallId] } };
    }
    if (recipeCallIds !== undefined) {
        return parseRecipeCallIds(recipeCallIds, toolName);
    }
    return invalid;
}

/**
 * The strict argument contract of one `analysis.measure` call.
 *
 * Only the argument shape is decided here. Whether a range's start precedes its
 * end, whether a section or target exists, and whether the range fits the
 * render ceilings are answered by the executor against the project.
 *
 * `toolName` is the tool the refusals name: `analysis.compareReference` takes the same
 * scope, range and metrics, so it reads them through this contract. `maxTargets` is the
 * most track or bus ids that tool's receipt can carry.
 */
export function parseAnalysisMeasureArguments(
    argumentsValue: unknown,
    toolName: string = ANALYSIS_MEASURE_TOOL_NAME,
    maxTargets: number = ANALYSIS_MEASURE_MAX_TARGETS
): ParsedAnalysisMeasureArguments {
    if (
        !isRecord(argumentsValue) ||
        !hasOnlyKeys(argumentsValue, [
            'scope',
            'range',
            'metrics',
            'subject',
            'proposal',
            'recipeCallId',
            'recipeCallIds',
        ])
    ) {
        return {
            status: 'invalid',
            reason: `${toolName} accepts only scope, range, metrics, subject, proposal, recipeCallId and recipeCallIds.`,
        };
    }
    const parsedSubject = parseSubject(argumentsValue, toolName);
    if (parsedSubject.status === 'invalid') {
        return parsedSubject;
    }
    const { subject } = parsedSubject;
    const scope = parseScope(argumentsValue.scope, maxTargets);
    if (scope === null) {
        return {
            status: 'invalid',
            reason: `${toolName} scope must be master, project, or tracks or buses with 1 to ${String(maxTargets)} distinct ids.`,
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
