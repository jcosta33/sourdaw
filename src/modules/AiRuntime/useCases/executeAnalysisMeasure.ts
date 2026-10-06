import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';
import { renderAgentMeasurementScope, retainAgentMeasurementRenders } from '#/modules/AudioRendering/useCases';
import { readSecondsAtBeat } from '#/modules/Transport/stores';
import { digest } from '#/utils/canonicalDigest';

import { ANALYSIS_MEASURE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { ANALYSIS_MEASURE_MAX_WARNING_LENGTH, ANALYSIS_MEASURE_MAX_WARNINGS } from '../models/AnalysisMeasureLimits';
import { type AnalysisMeasureRead } from '../models/AnalysisMeasureRead';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import {
    describeMeasurementStop,
    planMeasurementWork,
    type MeasurementAdmitter,
    type MeasurementRun,
} from '../models/MeasurementBudget';
import { type ProjectContextSection } from '../models/ProjectContext';
import { type ToolCallResult } from '../models/ToolCallResult';
import { readAgentResourceLimits } from '../stores/agentResourceLimitsStore';

import { beginMeasurementRun } from './beginMeasurementRun';
import { executePreviewMeasurement } from './executePreviewMeasurement';
import { parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';
import { readMeasurementRenderedSeconds } from './readMeasurementRenderedSeconds';
import { reduceMeasuredTargets } from './reduceMeasuredTargets';
import { resolveAnalysisMeasureBeats } from './resolveAnalysisMeasureBeats';

type ExecuteAnalysisMeasureInput = {
    call: ToolCallResult;
    callId: string;
    turn: number;
    /** The revision the planning loop read the project at. */
    projectRevision: string;
    /** The sections the loop's project reads report, which a `sectionId` range names. */
    sections: readonly ProjectContextSection[];
    signal?: AbortSignal;
    /** The run's admission of this measurement's renders and reductions; absent outside a run, which spends no budget. */
    admit?: MeasurementAdmitter;
    /** What a `preview` subject compiles and grounds its proposal against; absent, previews are unavailable. */
    preview?: Parameters<typeof executePreviewMeasurement>[0]['preview'];
};

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];
type ScopeRender = Awaited<ReturnType<typeof renderAgentMeasurementScope>>;
type ScopeRefusal = Extract<ScopeRender, { status: 'refused' }>;
type RenderedScopeTarget = Extract<ScopeRender, { status: 'rendered' }>['targets'][number];
type ReducedTarget = Pick<RenderedScopeTarget, 'targetId' | 'targetKind' | 'route' | 'liveAudibility' | 'artifact'> & {
    soloActive: boolean;
    measurements: ReturnType<typeof measureAgentScopeRender>;
};

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
    const resolved = resolveAnalysisMeasureBeats(range, sections);
    if (resolved.status === 'failure') {
        return resolved;
    }
    const { startBeat, endBeat, sectionId } = resolved.beats;
    const { measurementMeasuredSeconds, measurementRenderedSeconds } = readAgentResourceLimits();
    const measuredSeconds = readSecondsAtBeat({ beat: endBeat }) - readSecondsAtBeat({ beat: startBeat });
    const renderedSeconds = readMeasurementRenderedSeconds(endBeat);
    if (measuredSeconds > measurementMeasuredSeconds || renderedSeconds > measurementRenderedSeconds) {
        return {
            status: 'failure',
            failure: {
                code: 'range-exceeds-ceiling',
                safeMessage: `A measurement covers at most ${String(measurementMeasuredSeconds)} s and ends within ${String(measurementRenderedSeconds)} s of the project start.`,
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
        'disabled-contributor': {
            safeMessage: `Target ${target} cannot be measured in isolation: its disabled contributor ${String(refusal.contributorId)} builds no live strip.`,
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
    rendered: Extract<ScopeRender, { status: 'rendered' }>,
    targets: readonly ReducedTarget[],
    retentionWarnings: readonly string[]
): ApplicationToolReceipt {
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
        // Retention lines lead: the cap cuts from the end, and a cited render left unnamed is the worse loss.
        warnings: boundedWarnings([...retentionWarnings, ...rendered.warnings]),
        error: null,
    };
}

function read(receipt: ApplicationToolReceipt): AnalysisMeasureRead {
    return { receipt, commands: null, measuredPreview: null };
}

/**
 * Execute one `analysis.measure` call: render the named scope offline at the
 * loop's project revision and reduce each render to objective figures.
 *
 * The receipt carries figures and each render's content address, never
 * samples; the render itself stays in AudioRendering's measurement retention.
 * A `preview` subject renders a proposed list in isolation beside the project
 * and returns, besides the receipt, the commands it measured for a proposal
 * to adopt; a `project` subject returns its receipt alone, as it always has.
 */
export async function executeAnalysisMeasure(input: ExecuteAnalysisMeasureInput): Promise<AnalysisMeasureRead> {
    const parsed = parseAnalysisMeasureArguments(input.call.arguments);
    if (parsed.status === 'invalid') {
        return read(failureReceipt(input, { code: 'invalid-arguments', safeMessage: parsed.reason, retryable: true }));
    }
    const { subject } = parsed.value;
    if (subject.kind === 'preview') {
        if (input.preview === undefined) {
            return read(
                failureReceipt(input, {
                    code: 'preview-unavailable',
                    safeMessage: 'Measuring a proposal preview is unavailable to this run.',
                    retryable: false,
                })
            );
        }
        return executePreviewMeasurement({
            ...input,
            preview: input.preview,
            parsed: parsed.value,
            proposal: subject.proposal,
        });
    }
    return read(await measureProject(input, parsed.value));
}

async function measureProject(
    input: ExecuteAnalysisMeasureInput,
    parsed: ParsedArguments
): Promise<ApplicationToolReceipt> {
    const resolved = resolveRange(parsed.range, input.sections);
    if (resolved.status === 'failure') {
        return failureReceipt(input, resolved.failure);
    }
    const started = beginMeasurementRun({
        admit: input.admit,
        planned: planMeasurementWork({ scope: parsed.scope, subject: 'project' }),
        runSignal: input.signal,
        renderedSeconds: resolved.range.renderedSeconds,
    });
    if (started.status === 'refused') {
        return failureReceipt(input, started.failure);
    }
    try {
        return await renderAndReduce(input, parsed, resolved.range, started.run);
    } finally {
        started.run.settle();
    }
}

async function renderAndReduce(
    input: ExecuteAnalysisMeasureInput,
    parsed: ParsedArguments,
    range: MeasuredRange,
    run: MeasurementRun
): Promise<ApplicationToolReceipt> {
    const { scope } = parsed;
    const rendered = await renderAgentMeasurementScope({
        scope: scope.kind === 'tracks' || scope.kind === 'buses' ? scope : { kind: 'master' },
        startBeat: range.startBeat,
        endBeat: range.endBeat,
        sourceRevision: input.projectRevision,
        signal: run.signal,
        onRenderStart: run.countRender,
    });
    if (rendered.status === 'cancelled') {
        return failureReceipt(input, describeMeasurementStop(run.stopReason() ?? 'cancelled'));
    }
    if (rendered.status === 'refused') {
        return failureReceipt(input, refusalFailure(rendered, scope));
    }
    const reduction = await reduceMeasuredTargets({
        targets: rendered.targets,
        run,
        reduce: (target) => ({
            targetId: target.targetId,
            targetKind: target.targetKind,
            route: target.route,
            liveAudibility: target.liveAudibility,
            soloActive: rendered.soloActive,
            artifact: target.artifact,
            measurements: measureAgentScopeRender(target.buffer, parsed.metrics),
        }),
    });
    if (reduction.status === 'stopped') {
        return failureReceipt(input, describeMeasurementStop(reduction.reason));
    }
    // Retained only now the measurement reports, so one that stops or throws first leaves the store as it was.
    const retentionWarnings = retainAgentMeasurementRenders({
        renders: rendered.targets.map((target) => ({
            contentAddress: target.artifact.contentAddress,
            buffer: target.buffer,
        })),
        sourceRevision: input.projectRevision,
    });
    return successReceipt(input, parsed, range, rendered, reduction.reduced, retentionWarnings);
}
