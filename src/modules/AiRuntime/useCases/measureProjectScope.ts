import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';
import { renderAgentMeasurementScope, retainAgentMeasurementRenders } from '#/modules/AudioRendering/useCases';

import {
    describeMeasurementStop,
    planMeasurementWork,
    type MeasurementAdmitter,
    type MeasurementFailure,
    type MeasurementRun,
} from '../models/MeasurementBudget';
import { type ProjectContextSection } from '../models/ProjectContext';

import { beginMeasurementRun } from './beginMeasurementRun';
import { boundedMeasurementWarnings } from './boundedMeasurementWarnings';
import { type parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';
import { projectRefusalFailure } from './projectRefusalFailure';
import { reduceMeasuredTargets } from './reduceMeasuredTargets';
import { resolveMeasuredRange, type MeasuredRange } from './resolveMeasuredRange';

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];
type ScopeRender = Awaited<ReturnType<typeof renderAgentMeasurementScope>>;
type RenderedScopeTarget = Extract<ScopeRender, { status: 'rendered' }>['targets'][number];

/** What a project measurement reads of a call: the scope, the range and the metrics. */
type ProjectMeasurementRequest = Pick<ParsedArguments, 'scope' | 'range' | 'metrics'>;

export type ProjectMeasurementInput = {
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

export type ProjectMeasurement = {
    range: MeasuredRange;
    targets: readonly ReducedTarget[];
    /** Retention lines lead: the cap cuts from the end, and a cited render left unnamed is the worse loss. */
    warnings: readonly string[];
};

type ProjectMeasurementResult =
    { status: 'measured'; measurement: ProjectMeasurement } | { status: 'failed'; failure: MeasurementFailure };

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
        return { status: 'failed', failure: projectRefusalFailure(rendered, scope) };
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
            warnings: boundedMeasurementWarnings([...retentionWarnings, ...rendered.warnings]),
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
    const resolved = resolveMeasuredRange(request.range, input.sections);
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
