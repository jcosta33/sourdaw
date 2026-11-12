import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';
import { renderAgentMeasurementWindows, retainAgentMeasurementRenders } from '#/modules/AudioRendering/useCases';

import { describeMeasurementStop, type MeasurementFailure } from '../models/MeasurementBudget';

import { beginMeasurementRun } from './beginMeasurementRun';
import {
    boundedMeasurementWarnings,
    projectRefusalFailure,
    resolveMeasuredRange,
    type MeasuredRange,
    type ProjectMeasurement,
    type ProjectMeasurementInput,
    type ReducedTarget,
} from './measureProjectScope';
import { parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';
import { countMeasurementUnitWork, type MeasurementUnit } from './planMetricMeasurementRequests';
import { reduceMeasuredTargets } from './reduceMeasuredTargets';

type WindowsRender = Awaited<ReturnType<typeof renderAgentMeasurementWindows>>;
type RenderedWindows = Extract<WindowsRender, { status: 'rendered' }>;
type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];

/** Which target of a unit is rendering now, and over which range group. */
export type MeasurementUnitProgress = {
    targetId: string;
    document: 'project' | 'preview';
    /** The prefix document a preview render is of; `null` for the live project. */
    prefix: string | null;
    groupIndex: number;
    groupCount: number;
};

/** One read of a unit as an `analysis.measure` call would state it, so its receipt reads exactly as one. */
export type MeasurementUnitCall = Pick<ParsedArguments, 'scope' | 'range' | 'metrics'>;

type ProjectUnitResult =
    | { status: 'measured'; reads: { call: MeasurementUnitCall; measurement: ProjectMeasurement }[] }
    | { status: 'failed'; failure: MeasurementFailure };

/** A unit read normalized through the tool's own argument contract: canonical scope, range and metric order. */
export function readMeasurementUnitCall(
    unit: MeasurementUnit,
    read: MeasurementUnit['reads'][number]
): MeasurementUnitCall | MeasurementFailure {
    const range =
        read.range.sectionId === null
            ? { startBeat: read.range.startBeat, endBeat: read.range.endBeat }
            : { sectionId: read.range.sectionId };
    const parsed = parseAnalysisMeasureArguments({ scope: unit.scope, range, metrics: read.metrics });
    if (parsed.status === 'invalid') {
        return { code: 'invalid-arguments', safeMessage: parsed.reason, retryable: false };
    }
    const { scope, metrics } = parsed.value;
    return { scope, range: parsed.value.range, metrics };
}

function windowKey(range: { startBeat: number; endBeat: number }): string {
    return `${String(range.startBeat)}:${String(range.endBeat)}`;
}

function windowIndex(group: MeasurementUnit['groups'][number], range: MeasuredRange): number {
    return group.ranges.findIndex((window) => windowKey(window) === windowKey(range));
}

function windowRenders(rendered: readonly RenderedWindows[]) {
    return rendered.flatMap((render) =>
        render.targets.flatMap((target) =>
            target.windows.map((window) => ({ contentAddress: window.artifact.contentAddress, buffer: window.buffer }))
        )
    );
}

/**
 * Measure one project unit: admit its planned renders and reductions against the run, render each
 * target once per range group over the group's span, and reduce every range from its own window.
 * The renders are retained only once every reduction succeeded, so a unit that stops, times out,
 * is refused or throws leaves the artifact store as it found it, and the budget settles to what ran.
 */
export async function measureProjectUnit(
    input: ProjectMeasurementInput & { onProgress?: (progress: MeasurementUnitProgress) => void },
    unit: MeasurementUnit
): Promise<ProjectUnitResult> {
    const reads: { call: MeasurementUnitCall; range: MeasuredRange }[] = [];
    for (const read of unit.reads) {
        const call = readMeasurementUnitCall(unit, read);
        if ('code' in call) {
            return { status: 'failed', failure: call };
        }
        const resolved = resolveMeasuredRange(call.range, input.sections);
        if (resolved.status === 'failure') {
            return { status: 'failed', failure: resolved.failure };
        }
        reads.push({ call, range: resolved.range });
    }
    const work = countMeasurementUnitWork(unit);
    const started = beginMeasurementRun({
        admit: input.admit,
        planned: { renderJobs: work.renderJobs, analyses: work.analyses },
        runSignal: input.signal,
        renderedSeconds: work.renderedSeconds,
    });
    if (started.status === 'refused') {
        return { status: 'failed', failure: started.failure };
    }
    const { run } = started;
    try {
        const rendered: RenderedWindows[] = [];
        const reduced = new Map<number, ReducedTarget[]>();
        for (const [groupIndex, group] of unit.groups.entries()) {
            const render = await renderAgentMeasurementWindows({
                scope: unit.scope,
                windows: group.ranges,
                sourceRevision: input.projectRevision,
                signal: run.signal,
                onRenderStart: ({ targetId, document }) => {
                    run.countRender();
                    input.onProgress?.({
                        targetId,
                        document,
                        prefix: null,
                        groupIndex,
                        groupCount: unit.groups.length,
                    });
                },
            });
            if (render.status === 'cancelled') {
                return { status: 'failed', failure: describeMeasurementStop(run.stopReason() ?? 'cancelled') };
            }
            if (render.status === 'refused') {
                return { status: 'failed', failure: projectRefusalFailure(render, reads[0]!.call.scope) };
            }
            rendered.push(render);
            const items = reads.flatMap((read, readIndex) => {
                const index = windowIndex(group, read.range);
                return index < 0
                    ? []
                    : render.targets.map((target) => ({ readIndex, read, target, window: target.windows[index]! }));
            });
            const reduction = await reduceMeasuredTargets({
                targets: items,
                run,
                reduce: ({ readIndex, read, target, window }) => {
                    const entry: ReducedTarget = {
                        targetId: target.targetId,
                        targetKind: target.targetKind,
                        route: target.route,
                        liveAudibility: target.liveAudibility,
                        soloActive: render.soloActive,
                        artifact: window.artifact,
                        measurements: measureAgentScopeRender(window.buffer, read.call.metrics),
                    };
                    reduced.set(readIndex, [...(reduced.get(readIndex) ?? []), entry]);
                    return entry;
                },
            });
            if (reduction.status === 'stopped') {
                return { status: 'failed', failure: describeMeasurementStop(reduction.reason) };
            }
        }
        // Retained only now every reduction succeeded, so a unit that stops or throws first leaves the store as it was.
        const retentionWarnings = retainAgentMeasurementRenders({
            renders: windowRenders(rendered),
            sourceRevision: input.projectRevision,
        });
        const warnings = boundedMeasurementWarnings([
            ...retentionWarnings,
            ...rendered.flatMap((render) => render.warnings),
        ]);
        return {
            status: 'measured',
            reads: reads.map((read, readIndex) => ({
                call: read.call,
                measurement: { range: read.range, targets: reduced.get(readIndex) ?? [], warnings },
            })),
        };
    } finally {
        run.settle();
    }
}
