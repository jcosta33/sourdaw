import { renderAgentPreviewMeasurementScope, retainAgentMeasurementRenders } from '#/modules/AudioRendering/useCases';
import {
    previewVersionedCommandBatchEnvelope,
    type parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';

import { ANALYSIS_MEASURE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { ANALYSIS_MEASURE_MAX_WARNING_LENGTH, ANALYSIS_MEASURE_MAX_WARNINGS } from '../models/AnalysisMeasureLimits';
import { type AnalysisMeasureRead } from '../models/AnalysisMeasureRead';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type CreativeRequestAuthority } from '../models/CreativeInterpretation';
import { type MeasuredPreview } from '../models/MeasuredPreview';
import {
    describeMeasurementStop,
    planMeasurementWork,
    type MeasurementAdmitter,
    type MeasurementRun,
} from '../models/MeasurementBudget';
import { type ProjectContext, type ProjectContextSection } from '../models/ProjectContext';
import { type RetainedCommand, type RetainedCompilation } from '../models/RetainedCompilation';
import { type ToolCallResult } from '../models/ToolCallResult';
import { readAgentResourceLimits } from '../stores/agentResourceLimitsStore';

import { artifactOf } from './artifactOf';
import { beginMeasurementRun } from './beginMeasurementRun';
import { compilePreviewMeasurementProposal } from './compilePreviewMeasurementProposal';
import { digestCommandBatchContent } from './digestCommandBatchContent';
import { measuredPreviewRead } from './measuredPreviewRead';
import { measurePreviewTarget, type RenderedPreviewTarget } from './measurePreviewTarget';
import { type parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';
import { previewFailure } from './previewFailure';
import { previewRefusalFailure, type PreviewMeasurementFailure } from './previewRefusalFailure';
import { readMeasurementRenderedSeconds } from './readMeasurementRenderedSeconds';
import { reduceMeasuredTargets } from './reduceMeasuredTargets';
import { resolveAnalysisMeasureBeats } from './resolveAnalysisMeasureBeats';

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];
type PreviewRender = Awaited<ReturnType<typeof renderAgentPreviewMeasurementScope>>;
type RenderedPreview = Extract<PreviewRender, { status: 'rendered' }>;
type RenderedTarget = RenderedPreviewTarget;

export type ExecutePreviewMeasurementInput = {
    call: ToolCallResult;
    callId: string;
    turn: number;
    projectRevision: string;
    sections: readonly ProjectContextSection[];
    signal?: AbortSignal;
    /** The run's admission of this measurement's renders and reductions; absent outside a run, which spends no budget. */
    admit?: MeasurementAdmitter;
    parsed: ParsedArguments;
    source: Extract<ParsedArguments['subject'], { kind: 'preview' }>;
    /** The run's read model, request and authority, which the proposal is compiled and grounded against. */
    preview: {
        context: ProjectContext;
        origin?: 'planner' | 'approval-preview';
        /** Internal proof refresh only; provider arguments cannot supply this capability. */
        preparedBatch?: Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>['envelope'];
        /** Snapshot of successful receipt-admitted compilations from earlier turns only. */
        retainedCompilations?: readonly RetainedCompilation[];
        prompt: string;
        runId: string;
        /** The creative authority admitted so far in the run; read when the call executes. */
        readCreativeAuthority: () => CreativeRequestAuthority | undefined;
    };
};

function failure(input: ExecutePreviewMeasurementInput, reason: PreviewMeasurementFailure): AnalysisMeasureRead {
    const receipt: ApplicationToolReceipt = {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: input.callId,
        toolName: ANALYSIS_MEASURE_TOOL_NAME,
        turn: input.turn,
        status: 'failure',
        revision: null,
        data: null,
        summary: reason.safeMessage,
        warnings: [],
        error: reason,
    };
    return { receipt, commands: null, measuredPreview: null };
}

/** Each baseline target beside the same target in the preview; `null` when the two documents rendered different targets. */
function pairTargets(rendered: RenderedPreview): Array<[RenderedTarget, RenderedTarget]> | null {
    const previewById = new Map(rendered.preview.targets.map((target) => [target.targetId, target]));
    const pairs: Array<[RenderedTarget, RenderedTarget]> = [];
    for (const baseline of rendered.baseline.targets) {
        const preview = previewById.get(baseline.targetId);
        if (preview === undefined) {
            return null;
        }
        pairs.push([baseline, preview]);
    }
    return pairs.length === rendered.preview.targets.length ? pairs : null;
}

function boundedWarnings(rendered: RenderedPreview, retentionWarnings: readonly string[]): string[] {
    // Retention lines lead: the cap cuts from the end, and a cited render left unnamed is the worse loss.
    return [...retentionWarnings, ...rendered.baseline.warnings, ...rendered.preview.warnings]
        .slice(0, ANALYSIS_MEASURE_MAX_WARNINGS)
        .map((warning) => warning.slice(0, ANALYSIS_MEASURE_MAX_WARNING_LENGTH));
}

function successRead(
    input: ExecutePreviewMeasurementInput,
    rendered: RenderedPreview,
    pairs: ReadonlyArray<[RenderedTarget, RenderedTarget]>,
    measured: {
        beats: MeasuredPreview['range'];
        commands: readonly RetainedCommand[];
        batchContentHash: string;
        recipeSource?: MeasuredPreview['recipeSource'];
        targets: MeasuredPreview['targets'];
        retentionWarnings: readonly string[];
    }
): AnalysisMeasureRead {
    return measuredPreviewRead({
        callId: input.callId,
        turn: input.turn,
        projectRevision: input.projectRevision,
        origin: input.preview.origin ?? 'planner',
        runId: input.preview.runId,
        scope: input.parsed.scope,
        metrics: input.parsed.metrics,
        beats: measured.beats,
        commands: measured.commands,
        batchContentHash: measured.batchContentHash,
        recipeSource: measured.recipeSource,
        targets: measured.targets,
        renders: pairs.map(([baseline, preview]) => ({
            targetId: baseline.targetId,
            baseline: artifactOf(baseline),
            preview: artifactOf(preview),
        })),
        baselineSeconds: rendered.baseline.rangeSeconds,
        previewSeconds: rendered.preview.rangeSeconds,
        warnings: boundedWarnings(rendered, measured.retentionWarnings),
    });
}

function sourceRecipe(input: ExecutePreviewMeasurementInput) {
    const source = input.source;
    if (!('recipeCallId' in source)) {
        return undefined;
    }
    return input.preview.retainedCompilations?.find(
        (entry): entry is Extract<RetainedCompilation, { kind: 'recipe' }> =>
            entry.callId === source.recipeCallId && entry.kind === 'recipe' && entry.revision === input.projectRevision
    );
}

function compileProposal(input: ExecutePreviewMeasurementInput) {
    try {
        if (input.preview.preparedBatch !== undefined) {
            return compilePreviewMeasurementProposal({
                callId: input.callId,
                source: { preparedBatch: input.preview.preparedBatch },
                context: input.preview.context,
                prompt: input.preview.prompt,
                revision: input.projectRevision,
                runId: input.preview.runId,
                creativeAuthority: input.preview.readCreativeAuthority(),
            });
        }
        const recipe = sourceRecipe(input);
        if ('recipeCallId' in input.source && recipe === undefined) {
            return {
                status: 'rejected' as const,
                reason: 'The recipeCallId must name a successful earlier-turn recipe expansion admitted in this run at the measurement revision.',
            };
        }
        let source: Parameters<typeof compilePreviewMeasurementProposal>[0]['source'] | null;
        if ('proposal' in input.source) {
            source = { proposal: input.source.proposal };
        } else if (recipe !== undefined) {
            source = { recipe };
        } else {
            source = null;
        }
        if (source === null) {
            return { status: 'rejected' as const, reason: 'The preview has no admitted source.' };
        }
        return compilePreviewMeasurementProposal({
            callId: input.callId,
            source,
            context: input.preview.context,
            prompt: input.preview.prompt,
            revision: input.projectRevision,
            runId: input.preview.runId,
            creativeAuthority: input.preview.readCreativeAuthority(),
        });
    } catch (error) {
        return { status: 'rejected' as const, reason: error instanceof Error ? error.message : String(error) };
    }
}

async function renderPreview(
    input: ExecutePreviewMeasurementInput,
    preview: Extract<ReturnType<typeof previewVersionedCommandBatchEnvelope>, { status: 'previewed' }>,
    beats: { startBeat: number; endBeat: number },
    run: MeasurementRun
): Promise<PreviewRender> {
    const { scope } = input.parsed;
    const { measurementMeasuredSeconds, measurementRenderedSeconds } = readAgentResourceLimits();
    try {
        return await renderAgentPreviewMeasurementScope({
            scope: scope.kind === 'tracks' || scope.kind === 'buses' ? scope : { kind: 'master' },
            startBeat: beats.startBeat,
            endBeat: beats.endBeat,
            sourceRevision: input.projectRevision,
            rangeCeilings: {
                measuredSeconds: measurementMeasuredSeconds,
                renderedSeconds: measurementRenderedSeconds,
            },
            preview: preview.workspace,
            signal: run.signal,
            onRenderStart: run.countRender,
        });
    } finally {
        preview.resource.release();
    }
}

function renderedRenders(rendered: RenderedPreview) {
    return [...rendered.baseline.targets, ...rendered.preview.targets].map((target) => ({
        contentAddress: target.artifact.contentAddress,
        buffer: target.buffer,
    }));
}

/** Render the preview's scope against the live project, then reduce each target's pair of renders. */
async function renderAndReduce(
    input: ExecutePreviewMeasurementInput,
    preview: Extract<ReturnType<typeof previewVersionedCommandBatchEnvelope>, { status: 'previewed' }>,
    measured: {
        beats: MeasuredPreview['range'];
        commands: readonly RetainedCommand[];
        batchContentHash: string;
        recipeSource?: MeasuredPreview['recipeSource'];
    },
    run: MeasurementRun
): Promise<AnalysisMeasureRead> {
    const rendered = await renderPreview(input, preview, measured.beats, run);
    if (rendered.status === 'cancelled') {
        return failure(input, describeMeasurementStop(run.stopReason() ?? 'cancelled'));
    }
    if (rendered.status === 'refused') {
        return failure(input, previewRefusalFailure(rendered));
    }
    const pairs = pairTargets(rendered);
    if (pairs === null) {
        return failure(input, {
            code: 'preview-unavailable',
            safeMessage: 'The project and the preview rendered different targets for this scope.',
            retryable: false,
        });
    }
    const reduction = await reduceMeasuredTargets({
        targets: pairs,
        run,
        reduce: ([baseline, previewTarget]) => measurePreviewTarget(baseline, previewTarget, input.parsed.metrics),
    });
    if (reduction.status === 'stopped') {
        return failure(input, describeMeasurementStop(reduction.reason));
    }
    // Retained only now the measurement reports, so one that stops or throws first leaves the store as it was.
    const retentionWarnings = retainAgentMeasurementRenders({
        renders: renderedRenders(rendered),
        sourceRevision: input.projectRevision,
    });
    return successRead(input, rendered, pairs, { ...measured, targets: reduction.reduced, retentionWarnings });
}

/**
 * Measure a semantic list or retained recipe without applying it: compile and ground it as a
 * proposal would be, preview the resulting batch in an isolated workspace, render the scope over
 * the same range for the live project and for that preview, and reduce both to figures and
 * per-metric deltas. The commands measured are returned for the loop to retain under this call id,
 * so a later proposal adopts exactly what was measured. Every refusal is a typed failure receipt,
 * and nothing here writes the live project.
 */
export async function executePreviewMeasurement(input: ExecutePreviewMeasurementInput): Promise<AnalysisMeasureRead> {
    const resolved = resolveAnalysisMeasureBeats(input.parsed.range, input.sections);
    if (resolved.status === 'failure') {
        return failure(input, resolved.failure);
    }
    const compiled = compileProposal(input);
    if (compiled.status === 'rejected') {
        return failure(input, { code: 'preview-proposal-rejected', safeMessage: compiled.reason, retryable: true });
    }
    const preview = previewVersionedCommandBatchEnvelope(compiled.envelope);
    if (preview.status !== 'previewed') {
        return failure(input, previewFailure(preview.status, 'reason' in preview ? preview.reason : undefined));
    }
    const started = beginMeasurementRun({
        admit: input.admit,
        planned: planMeasurementWork({ scope: input.parsed.scope, subject: 'preview' }),
        runSignal: input.signal,
        renderedSeconds: readMeasurementRenderedSeconds(resolved.beats.endBeat),
    });
    if (started.status === 'refused') {
        preview.resource.release();
        return failure(input, started.failure);
    }
    try {
        return await renderAndReduce(
            input,
            preview,
            {
                beats: resolved.beats,
                commands: compiled.commands,
                recipeSource: compiled.recipeSource,
                batchContentHash: digestCommandBatchContent(compiled.envelope),
            },
            started.run
        );
    } finally {
        started.run.settle();
    }
}
