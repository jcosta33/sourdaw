import { renderAgentPreviewMeasurementWindows, retainAgentMeasurementRenders } from '#/modules/AudioRendering/useCases';
import { previewVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { ANALYSIS_MEASURE_MAX_WARNING_LENGTH, ANALYSIS_MEASURE_MAX_WARNINGS } from '../models/AnalysisMeasureLimits';
import { type MeasuredPreview } from '../models/MeasuredPreview';
import {
    describeMeasurementStop,
    type MeasurementAdmitter,
    type MeasurementFailure,
} from '../models/MeasurementBudget';
import { type ProjectContextSection } from '../models/ProjectContext';
import { type RetainedCommand } from '../models/RetainedCompilation';
import { readAgentResourceLimits } from '../stores/agentResourceLimitsStore';

import { artifactOf } from './artifactOf';
import { beginMeasurementRun } from './beginMeasurementRun';
import { compilePreviewPrefix, type CompiledPrefix } from './compilePreviewPrefix';
import { countMeasurementUnitWork } from './countMeasurementUnitWork';
import { type ExecutePreviewMeasurementInput } from './executePreviewMeasurement';
import { measurePreviewTarget, type RenderedPreviewTarget } from './measurePreviewTarget';
import { type MeasurementUnitProgress } from './measureProjectUnit';
import { type MeasurementRenderGroup, type MeasurementUnit } from './planMetricMeasurementRequests';
import { previewFailure } from './previewFailure';
import { previewRefusalFailure } from './previewRefusalFailure';
import { readGroupPrefixes } from './readGroupPrefixes';
import { readMeasurementUnitCall, type MeasurementUnitCall } from './readMeasurementUnitCall';
import { reduceMeasuredTargets } from './reduceMeasuredTargets';
import { resolveAnalysisMeasureBeats } from './resolveAnalysisMeasureBeats';

type PreparedBatch = NonNullable<ExecutePreviewMeasurementInput['preview']['preparedBatch']>;
type WindowsRender = Awaited<ReturnType<typeof renderAgentPreviewMeasurementWindows>>;
type RenderedWindows = Extract<WindowsRender, { status: 'rendered' }>;
type WindowedSubject = RenderedWindows['baseline'];
type Workspace = Extract<ReturnType<typeof previewVersionedCommandBatchEnvelope>, { status: 'previewed' }>;

/** One (prefix, range) read of the unit's target, ready to report in the receipt it belongs to. */
export type PreviewUnitRead = {
    requestIndex: number;
    prefix: string;
    call: MeasurementUnitCall;
    beats: MeasuredPreview['range'];
    commands: readonly RetainedCommand[];
    batchContentHash: string;
    target: MeasuredPreview['targets'][number];
    renders: { baseline: ReturnType<typeof artifactOf>; preview: ReturnType<typeof artifactOf> };
    baselineSeconds: WindowedSubject['windowSeconds'][number];
    previewSeconds: WindowedSubject['windowSeconds'][number];
    warnings: string[];
};

type PreviewUnitResult =
    { status: 'measured'; reads: PreviewUnitRead[] } | { status: 'failed'; failure: MeasurementFailure };

type PreviewUnitInput = {
    unit: MeasurementUnit;
    /** The prepared batch prefix each prefix hash names. */
    envelopes: ReadonlyMap<string, PreparedBatch>;
    projectRevision: string;
    sections: readonly ProjectContextSection[];
    signal?: AbortSignal;
    admit?: MeasurementAdmitter;
    preview: Pick<ExecutePreviewMeasurementInput['preview'], 'context' | 'prompt' | 'runId' | 'readCreativeAuthority'>;
    onProgress?: (progress: MeasurementUnitProgress) => void;
};

function compilePrefixes(input: PreviewUnitInput): Map<string, CompiledPrefix> | MeasurementFailure {
    const compiled = new Map<string, CompiledPrefix>();
    for (const prefix of input.unit.prefixes) {
        const result = compilePreviewPrefix({
            prefix,
            preparedBatch: input.envelopes.get(prefix),
            projectRevision: input.projectRevision,
            preview: input.preview,
        });
        if ('code' in result) {
            return result;
        }
        compiled.set(prefix, result);
    }
    return compiled;
}

/** Opens one isolated workspace per prefix the group renders; all are released before any failure returns. */
function openWorkspaces(
    prefixes: readonly string[],
    compiled: ReadonlyMap<string, CompiledPrefix>
): Workspace[] | MeasurementFailure {
    const opened: Workspace[] = [];
    for (const prefix of prefixes) {
        const preview = previewVersionedCommandBatchEnvelope(compiled.get(prefix)!.envelope);
        if (preview.status !== 'previewed') {
            for (const workspace of opened) {
                workspace.resource.release();
            }
            return previewFailure(preview.status, 'reason' in preview ? preview.reason : undefined);
        }
        opened.push(preview);
    }
    return opened;
}

function singleWindow(subject: WindowedSubject, windowIndex: number): RenderedPreviewTarget | null {
    const [target] = subject.targets;
    if (target === undefined || subject.targets.length !== 1) {
        return null;
    }
    const { windows, ...rest } = target;
    const window = windows[windowIndex];
    return window === undefined ? null : { ...rest, ...window };
}

function windowIndexOf(group: MeasurementRenderGroup, beats: MeasuredPreview['range']): number {
    return group.ranges.findIndex((range) => range.startBeat === beats.startBeat && range.endBeat === beats.endBeat);
}

function boundedWarnings(warnings: readonly string[]): string[] {
    return warnings
        .slice(0, ANALYSIS_MEASURE_MAX_WARNINGS)
        .map((warning) => warning.slice(0, ANALYSIS_MEASURE_MAX_WARNING_LENGTH));
}

function windowRenders(rendered: readonly RenderedWindows[]) {
    return rendered.flatMap((render) =>
        [render.baseline, ...render.previews].flatMap((subject) =>
            subject.targets.flatMap((target) =>
                target.windows.map((window) => ({
                    contentAddress: window.artifact.contentAddress,
                    buffer: window.buffer,
                }))
            )
        )
    );
}

/** Renders the group in every opened workspace, releasing each on every outcome, as one preview measurement does. */
async function renderPrefixes(
    workspaces: readonly Workspace[],
    input: Parameters<typeof renderAgentPreviewMeasurementWindows>[0]
): Promise<WindowsRender> {
    try {
        return await renderAgentPreviewMeasurementWindows(input);
    } finally {
        for (const workspace of workspaces) {
            workspace.resource.release();
        }
    }
}

type UnitRead = { read: MeasurementUnit['reads'][number]; call: MeasurementUnitCall; beats: MeasuredPreview['range'] };

/** Every read of the unit as its tool call states it, over the beats its range resolves to. */
function readUnitReads(
    unit: MeasurementUnit,
    sections: readonly ProjectContextSection[]
): UnitRead[] | MeasurementFailure {
    const reads: UnitRead[] = [];
    for (const read of unit.reads) {
        const call = readMeasurementUnitCall(unit, read);
        if ('code' in call) {
            return call;
        }
        const resolved = resolveAnalysisMeasureBeats(call.range, sections);
        if (resolved.status === 'failure') {
            return resolved.failure;
        }
        reads.push({ read, call, beats: resolved.beats });
    }
    return reads;
}

type GroupPair = UnitRead & {
    windowIndex: number;
    preview: WindowedSubject;
    baselineTarget: RenderedPreviewTarget;
    previewTarget: RenderedPreviewTarget;
};

const UNPAIRED_PREVIEW: MeasurementFailure = {
    code: 'preview-unavailable',
    safeMessage: 'The project and the preview rendered different targets for this scope.',
    retryable: false,
};

/**
 * Each read the group holds, beside the live project's window and its prefix document's window of
 * that range. Both must hold the one same target, or the pair compares different audio.
 */
function pairGroupReads(
    reads: readonly UnitRead[],
    group: MeasurementRenderGroup,
    prefixes: readonly string[],
    render: RenderedWindows
): GroupPair[] | MeasurementFailure {
    const pairs: GroupPair[] = [];
    for (const { read, call, beats } of reads) {
        const windowIndex = windowIndexOf(group, beats);
        const previewIndex = prefixes.indexOf(read.prefix ?? '');
        if (windowIndex < 0 || previewIndex < 0) {
            continue;
        }
        const preview = render.previews[previewIndex]!;
        const baselineTarget = singleWindow(render.baseline, windowIndex);
        const previewTarget = singleWindow(preview, windowIndex);
        if (baselineTarget === null || previewTarget?.targetId !== baselineTarget.targetId) {
            return UNPAIRED_PREVIEW;
        }
        pairs.push({ read, call, beats, windowIndex, preview, baselineTarget, previewTarget });
    }
    return pairs;
}

/** What one paired read reports: its two windows' renders and seconds, and the target reduced from them. */
function readPairResult(
    pair: GroupPair,
    target: PreviewUnitRead['target'],
    compiled: ReadonlyMap<string, CompiledPrefix>,
    baseline: WindowedSubject,
    warnings: string[]
): PreviewUnitRead {
    const prefix = compiled.get(pair.read.prefix ?? '')!;
    return {
        requestIndex: pair.read.requestIndex,
        prefix: pair.read.prefix ?? '',
        call: pair.call,
        beats: pair.beats,
        commands: prefix.commands,
        batchContentHash: prefix.batchContentHash,
        target,
        renders: { baseline: artifactOf(pair.baselineTarget), preview: artifactOf(pair.previewTarget) },
        baselineSeconds: baseline.windowSeconds[pair.windowIndex]!,
        previewSeconds: pair.preview.windowSeconds[pair.windowIndex]!,
        warnings,
    };
}

/**
 * Measure one preview unit: one target in the live project and in every prefix document it is read
 * at. Its planned renders and reductions are admitted before anything renders; each range group
 * renders the live project once and each prefix document read there once, and every (prefix,
 * range) read is reduced from the two windows of that range. The renders are retained only once
 * every reduction succeeded, and the budget settles to what ran on every outcome.
 */
export async function measurePreviewUnit(input: PreviewUnitInput): Promise<PreviewUnitResult> {
    const { unit } = input;
    const reads = readUnitReads(unit, input.sections);
    if (!Array.isArray(reads)) {
        return { status: 'failed', failure: reads };
    }
    const compiled = compilePrefixes(input);
    if (!(compiled instanceof Map)) {
        return { status: 'failed', failure: compiled };
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
    const { measurementMeasuredSeconds, measurementRenderedSeconds } = readAgentResourceLimits();
    try {
        const rendered: RenderedWindows[] = [];
        const results: PreviewUnitRead[] = [];
        for (const [groupIndex, group] of unit.groups.entries()) {
            const prefixes = readGroupPrefixes(unit, group);
            const workspaces = openWorkspaces(prefixes, compiled);
            if (!Array.isArray(workspaces)) {
                return { status: 'failed', failure: workspaces };
            }
            const render = await renderPrefixes(workspaces, {
                scope: unit.scope,
                windows: group.ranges,
                sourceRevision: input.projectRevision,
                rangeCeilings: {
                    measuredSeconds: measurementMeasuredSeconds,
                    renderedSeconds: measurementRenderedSeconds,
                },
                previews: workspaces.map((workspace) => workspace.workspace),
                signal: run.signal,
                onRenderStart: ({ targetId, document, previewIndex }) => {
                    run.countRender();
                    input.onProgress?.({
                        targetId,
                        document,
                        prefix: previewIndex === null ? null : (prefixes[previewIndex] ?? null),
                        groupIndex,
                        groupCount: unit.groups.length,
                    });
                },
            });
            if (render.status === 'cancelled') {
                return { status: 'failed', failure: describeMeasurementStop(run.stopReason() ?? 'cancelled') };
            }
            if (render.status === 'refused') {
                return { status: 'failed', failure: previewRefusalFailure(render) };
            }
            rendered.push(render);
            const pairs = pairGroupReads(reads, group, prefixes, render);
            if (!Array.isArray(pairs)) {
                return { status: 'failed', failure: pairs };
            }
            const reduction = await reduceMeasuredTargets({
                targets: pairs,
                run,
                reduce: (pair) => measurePreviewTarget(pair.baselineTarget, pair.previewTarget, pair.call.metrics),
            });
            if (reduction.status === 'stopped') {
                return { status: 'failed', failure: describeMeasurementStop(reduction.reason) };
            }
            const warnings = [...render.baseline.warnings, ...render.previews.flatMap((subject) => subject.warnings)];
            results.push(
                ...pairs.map((pair, index) =>
                    readPairResult(pair, reduction.reduced[index]!, compiled, render.baseline, warnings)
                )
            );
        }
        // Retained only now every reduction succeeded, so a unit that stops or throws first leaves the store as it was.
        const retentionWarnings = retainAgentMeasurementRenders({
            renders: windowRenders(rendered),
            sourceRevision: input.projectRevision,
        });
        return {
            status: 'measured',
            reads: results.map((result) => ({
                ...result,
                warnings: boundedWarnings([...retentionWarnings, ...result.warnings]),
            })),
        };
    } finally {
        run.settle();
    }
}
