import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';
import { renderAgentMeasurementWindows, retainAgentMeasurementRenders } from '#/modules/AudioRendering/useCases';

import { describeMeasurementStop, type MeasurementFailure } from '../models/MeasurementBudget';

import { beginMeasurementRun } from './beginMeasurementRun';
import { boundedMeasurementWarnings } from './boundedMeasurementWarnings';
import { countMeasurementUnitWork } from './countMeasurementUnitWork';
import { type ProjectMeasurement, type ProjectMeasurementInput, type ReducedTarget } from './measureProjectScope';
import { type MeasurementUnit } from './planMetricMeasurementRequests';
import { projectRefusalFailure } from './projectRefusalFailure';
import { readMeasurementUnitCall, type MeasurementUnitCall } from './readMeasurementUnitCall';
import { reduceMeasuredTargets } from './reduceMeasuredTargets';
import { resolveMeasuredRange, type MeasuredRange } from './resolveMeasuredRange';

type WindowsRender = Awaited<ReturnType<typeof renderAgentMeasurementWindows>>;
type RenderedWindows = Extract<WindowsRender, { status: 'rendered' }>;

/** Which target of a unit is rendering now, and over which range group. */
export type MeasurementUnitProgress = {
    targetId: string;
    document: 'project' | 'preview';
    /** The prefix document a preview render is of; `null` for the live project. */
    prefix: string | null;
    groupIndex: number;
    groupCount: number;
};

type ProjectUnitResult =
    | { status: 'measured'; reads: { call: MeasurementUnitCall; measurement: ProjectMeasurement }[] }
    | { status: 'failed'; failure: MeasurementFailure };

function appendReducedTarget(reduced: Map<number, ReducedTarget[]>, readIndex: number, entry: ReducedTarget): void {
    const entries = reduced.get(readIndex);
    if (entries === undefined) {
        reduced.set(readIndex, [entry]);
        return;
    }
    entries.push(entry);
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

type UnitRead = { call: MeasurementUnitCall; range: MeasuredRange };

/** Every read of the unit as its tool call states it, over the beats its range resolves to. */
function readUnitReads(
    unit: MeasurementUnit,
    sections: ProjectMeasurementInput['sections']
): UnitRead[] | MeasurementFailure {
    const reads: UnitRead[] = [];
    for (const read of unit.reads) {
        const call = readMeasurementUnitCall(unit, read);
        if ('code' in call) {
            return call;
        }
        const resolved = resolveMeasuredRange(call.range, sections);
        if (resolved.status === 'failure') {
            return resolved.failure;
        }
        reads.push({ call, range: resolved.range });
    }
    return reads;
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
    const reads = readUnitReads(unit, input.sections);
    if (!Array.isArray(reads)) {
        return { status: 'failed', failure: reads };
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
                if (index < 0) {
                    return [];
                }
                return render.targets.map((target) => ({ readIndex, read, target, window: target.windows[index]! }));
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
                    appendReducedTarget(reduced, readIndex, entry);
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
