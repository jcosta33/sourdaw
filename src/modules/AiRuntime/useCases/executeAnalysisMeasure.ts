import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';
import { renderAgentMeasurementScope } from '#/modules/AudioRendering/useCases';
import { readSecondsAtBeat } from '#/modules/Transport/stores';
import { digest } from '#/utils/canonicalDigest';

import { ANALYSIS_MEASURE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import {
    ANALYSIS_MEASURE_MAX_MEASURED_SECONDS,
    ANALYSIS_MEASURE_MAX_RENDERED_SECONDS,
    ANALYSIS_MEASURE_MAX_WARNING_LENGTH,
    ANALYSIS_MEASURE_MAX_WARNINGS,
} from '../models/AnalysisMeasureLimits';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type ProjectContextSection } from '../models/ProjectContext';
import { type ToolCallResult } from '../models/ToolCallResult';

import { parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';

type ExecuteAnalysisMeasureInput = {
    call: ToolCallResult;
    callId: string;
    turn: number;
    /** The revision the planning loop read the project at. */
    projectRevision: string;
    /** The sections the loop's project reads report, which a `sectionId` range names. */
    sections: readonly ProjectContextSection[];
    signal?: AbortSignal;
};

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];
type ScopeRender = Awaited<ReturnType<typeof renderAgentMeasurementScope>>;
type ScopeRefusal = Extract<ScopeRender, { status: 'refused' }>;

type MeasuredRange = {
    startBeat: number;
    endBeat: number;
    sectionId: string | null;
    measuredSeconds: number;
    renderedSeconds: number;
};

type Failure = { code: string; safeMessage: string; retryable: boolean };

function failureReceipt(input: ExecuteAnalysisMeasureInput, failure: Failure): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: input.callId,
        toolName: ANALYSIS_MEASURE_TOOL_NAME,
        turn: input.turn,
        status: 'failure',
        revision: null,
        data: null,
        summary: failure.safeMessage,
        warnings: [],
        error: failure,
    };
}

/** The beat range the arguments name, with the seconds it measures and the seconds its render processes. */
function resolveRange(
    range: ParsedArguments['range'],
    sections: readonly ProjectContextSection[]
): { status: 'range'; range: MeasuredRange } | { status: 'failure'; failure: Failure } {
    let startBeat: number;
    let endBeat: number;
    let sectionId: string | null = null;
    if ('sectionId' in range) {
        const section = sections.find((candidate) => candidate.id === range.sectionId);
        if (section === undefined) {
            return {
                status: 'failure',
                failure: {
                    code: 'unknown-section',
                    safeMessage: `Section ${range.sectionId} is not in the project.`,
                    retryable: true,
                },
            };
        }
        ({ startBeat, endBeat } = section);
        sectionId = section.id;
    } else {
        ({ startBeat, endBeat } = range);
    }
    if (startBeat >= endBeat) {
        return {
            status: 'failure',
            failure: { code: 'invalid-range', safeMessage: 'The range must start before it ends.', retryable: true },
        };
    }
    const endSeconds = readSecondsAtBeat({ beat: endBeat });
    const measuredSeconds = endSeconds - readSecondsAtBeat({ beat: startBeat });
    const renderedSeconds = endSeconds - readSecondsAtBeat({ beat: 0 });
    if (
        measuredSeconds > ANALYSIS_MEASURE_MAX_MEASURED_SECONDS ||
        renderedSeconds > ANALYSIS_MEASURE_MAX_RENDERED_SECONDS
    ) {
        return {
            status: 'failure',
            failure: {
                code: 'range-exceeds-ceiling',
                safeMessage: `A measurement covers at most ${String(ANALYSIS_MEASURE_MAX_MEASURED_SECONDS)} s and ends within ${String(ANALYSIS_MEASURE_MAX_RENDERED_SECONDS)} s of the project start.`,
                retryable: true,
            },
        };
    }
    return { status: 'range', range: { startBeat, endBeat, sectionId, measuredSeconds, renderedSeconds } };
}

function refusalFailure(refusal: ScopeRefusal, scope: ParsedArguments['scope']): Failure {
    const target = refusal.targetId ?? 'master';
    const failures: Readonly<Record<ScopeRefusal['code'], Omit<Failure, 'code'>>> = {
        'unknown-target': { safeMessage: `Target ${target} is not in the project.`, retryable: true },
        'kind-mismatch': {
            safeMessage: `Target ${target} is not one of the ${scope.kind} this scope names.`,
            retryable: true,
        },
        'muted-contributor': {
            safeMessage: `Target ${target} cannot be measured in isolation: its muted contributor ${String(refusal.contributorId)} would be rendered unmuted.`,
            retryable: false,
        },
        'render-busy': { safeMessage: 'Another offline render is in progress.', retryable: true },
        'stale-revision': {
            safeMessage: 'The project changed while it was being measured; read it again before measuring.',
            retryable: true,
        },
        'empty-render': { safeMessage: `The render of ${target} holds no audio.`, retryable: false },
        'render-failed': { safeMessage: `The render of ${target} failed.`, retryable: false },
    };
    return { code: refusal.code, ...failures[refusal.code] };
}

function boundedWarnings(warnings: readonly string[]): string[] {
    return warnings
        .slice(0, ANALYSIS_MEASURE_MAX_WARNINGS)
        .map((warning) => warning.slice(0, ANALYSIS_MEASURE_MAX_WARNING_LENGTH));
}

function successReceipt(
    input: ExecuteAnalysisMeasureInput,
    parsed: ParsedArguments,
    range: MeasuredRange,
    rendered: Extract<ScopeRender, { status: 'rendered' }>
): ApplicationToolReceipt {
    const targets = rendered.targets.map((target) => ({
        targetId: target.targetId,
        targetKind: target.targetKind,
        route: target.route,
        liveAudibility: target.liveAudibility,
        soloActive: rendered.soloActive,
        artifact: target.artifact,
        measurements: measureAgentScopeRender(target.buffer, parsed.metrics),
    }));
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: input.callId,
        toolName: ANALYSIS_MEASURE_TOOL_NAME,
        turn: input.turn,
        status: 'success',
        revision: input.projectRevision,
        data: {
            kind: 'analysis-measurement',
            schemaVersion: 1,
            scope: parsed.scope,
            sourceRevisionDigest: digest(input.projectRevision),
            range,
            metrics: parsed.metrics,
            targets,
        },
        summary: `Measured ${String(targets.length)} target(s) over beats ${String(range.startBeat)} to ${String(range.endBeat)}.`,
        warnings: boundedWarnings(rendered.warnings),
        error: null,
    };
}

/**
 * Execute one `analysis.measure` call: render the named scope offline at the
 * loop's project revision and reduce each render to objective figures.
 *
 * The receipt carries figures and each render's content address, never
 * samples; the render itself stays in AudioRendering's measurement retention.
 */
export async function executeAnalysisMeasure(input: ExecuteAnalysisMeasureInput): Promise<ApplicationToolReceipt> {
    const parsed = parseAnalysisMeasureArguments(input.call.arguments);
    if (parsed.status === 'invalid') {
        return failureReceipt(input, { code: 'invalid-arguments', safeMessage: parsed.reason, retryable: true });
    }
    const resolved = resolveRange(parsed.value.range, input.sections);
    if (resolved.status === 'failure') {
        return failureReceipt(input, resolved.failure);
    }
    const { scope } = parsed.value;
    const rendered = await renderAgentMeasurementScope({
        scope: scope.kind === 'tracks' || scope.kind === 'buses' ? scope : { kind: 'master' },
        startBeat: resolved.range.startBeat,
        endBeat: resolved.range.endBeat,
        sourceRevision: input.projectRevision,
        signal: input.signal,
    });
    if (rendered.status === 'cancelled') {
        return failureReceipt(input, {
            code: 'cancelled',
            safeMessage: 'The measurement was cancelled.',
            retryable: false,
        });
    }
    if (rendered.status === 'refused') {
        return failureReceipt(input, refusalFailure(rendered, scope));
    }
    return successReceipt(input, parsed.value, resolved.range, rendered);
}
