import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';
import { renderAgentMeasurementScope, retainAgentMeasurementRenders } from '#/modules/AudioRendering/useCases';
import { readSecondsAtBeat } from '#/modules/Transport/stores';

import { ANALYSIS_MEASURE_MAX_WARNING_LENGTH, ANALYSIS_MEASURE_MAX_WARNINGS } from '../models/AnalysisMeasureLimits';
import {
    describeMeasurementStop,
    planMeasurementWork,
    type MeasurementAdmitter,
    type MeasurementFailure,
    type MeasurementRun,
} from '../models/MeasurementBudget';
import { type ProjectContextSection } from '../models/ProjectContext';
import { readAgentResourceLimits } from '../stores/agentResourceLimitsStore';

import { beginMeasurementRun } from './beginMeasurementRun';
import { type parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';
import { readMeasurementRenderedSeconds } from './readMeasurementRenderedSeconds';
import { reduceMeasuredTargets } from './reduceMeasuredTargets';
import { resolveAnalysisMeasureBeats } from './resolveAnalysisMeasureBeats';

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];
type ScopeRender = Awaited<ReturnType<typeof renderAgentMeasurementScope>>;
type ScopeRefusal = Extract<ScopeRender, { status: 'refused' }>;
type RenderedScopeTarget = Extract<ScopeRender, { status: 'rendered' }>['targets'][number];

/** What a project measurement reads of a call: the scope, the range and the metrics. */
type ProjectMeasurementRequest = Pick<ParsedArguments, 'scope' | 'range' | 'metrics'>;

type ProjectMeasurementInput = {
    /** The revision the planning loop read the project at. */
    projectRevision: string;
    /** The sections the loop's project reads report, which a `sectionId` range names. */
    sections: readonly ProjectContextSection[];
    signal?: AbortSignal;
    /** The run's admission of this measurement's renders and reductions; absent outside a run, which spends no budget. */
    admit?: MeasurementAdmitter;
};

export type ReducedTarget = Pick<
    RenderedScopeTarget,
    'targetId' | 'targetKind' | 'route' | 'liveAudibility' | 'artifact'
> & {
    soloActive: boolean;
    measurements: ReturnType<typeof measureAgentScopeRender>;
};

export type MeasuredRange = {
    startBeat: number;
    endBeat: number;
    sectionId: string | null;
    measuredSeconds: number;
    renderedSeconds: number;
};

type ProjectMeasurement = {
    range: MeasuredRange;
    targets: readonly ReducedTarget[];
    /** Retention lines lead: the cap cuts from the end, and a cited render left unnamed is the worse loss. */
    warnings: readonly string[];
};

type ProjectMeasurementResult =
    { status: 'measured'; measurement: ProjectMeasurement } | { status: 'failed'; failure: MeasurementFailure };

/** The beat range the arguments name, with the seconds it measures and the seconds its render processes. */
function resolveRange(
    range: ProjectMeasurementRequest['range'],
    sections: readonly ProjectContextSection[]
): { status: 'range'; range: MeasuredRange } | { status: 'failure'; failure: MeasurementFailure } {
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

function refusalFailure(refusal: ScopeRefusal, scope: ProjectMeasurementRequest['scope']): MeasurementFailure {
    const target = refusal.targetId ?? 'master';
    const failures: Readonly<Record<ScopeRefusal['code'], Omit<MeasurementFailure, 'code'>>> = {
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

async function renderAndReduce(
    input: ProjectMeasurementInput,
    request: ProjectMeasurementRequest,
    range: MeasuredRange,
    run: MeasurementRun
): Promise<ProjectMeasurementResult> {
    const { scope } = request;
    const rendered = await renderAgentMeasurementScope({
        scope: scope.kind === 'tracks' || scope.kind === 'buses' ? scope : { kind: 'master' },
        startBeat: range.startBeat,
        endBeat: range.endBeat,
        sourceRevision: input.projectRevision,
        signal: run.signal,
        onRenderStart: run.countRender,
    });
    if (rendered.status === 'cancelled') {
        return { status: 'failed', failure: describeMeasurementStop(run.stopReason() ?? 'cancelled') };
    }
    if (rendered.status === 'refused') {
        return { status: 'failed', failure: refusalFailure(rendered, scope) };
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
            measurements: measureAgentScopeRender(target.buffer, request.metrics),
        }),
    });
    if (reduction.status === 'stopped') {
        return { status: 'failed', failure: describeMeasurementStop(reduction.reason) };
    }
    // Retained only now the measurement reports, so one that stops or throws first leaves the store as it was.
    const retentionWarnings = retainAgentMeasurementRenders({
        renders: rendered.targets.map((target) => ({
            contentAddress: target.artifact.contentAddress,
            buffer: target.buffer,
        })),
        sourceRevision: input.projectRevision,
    });
    return {
        status: 'measured',
        measurement: {
            range,
            targets: reduction.reduced,
            warnings: boundedWarnings([...retentionWarnings, ...rendered.warnings]),
        },
    };
}

/**
 * Measure the live project over the named scope and range: admit the measurement against the run's
 * budgets, render the scope offline at the loop's project revision, and reduce each render to
 * objective figures. Every refusal is a typed failure, and nothing here writes the project.
 *
 * `analysis.measure` reports these figures as they are; `analysis.compareReference` reports them
 * beside a reference's. Both read the project through this one path, so they share its budgets,
 * deadline and revision binding.
 */
export async function measureProjectScope(
    input: ProjectMeasurementInput,
    request: ProjectMeasurementRequest
): Promise<ProjectMeasurementResult> {
    const resolved = resolveRange(request.range, input.sections);
    if (resolved.status === 'failure') {
        return { status: 'failed', failure: resolved.failure };
    }
    const started = beginMeasurementRun({
        admit: input.admit,
        planned: planMeasurementWork({ scope: request.scope, subject: 'project' }),
        runSignal: input.signal,
        renderedSeconds: resolved.range.renderedSeconds,
    });
    if (started.status === 'refused') {
        return { status: 'failed', failure: started.failure };
    }
    try {
        return await renderAndReduce(input, request, resolved.range, started.run);
    } finally {
        started.run.settle();
    }
}
