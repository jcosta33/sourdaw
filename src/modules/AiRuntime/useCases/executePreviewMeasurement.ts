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
import { type AdoptedRecipe, type RetainedCommand, type RetainedCompilation } from '../models/RetainedCompilation';
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

type RetainedRecipe = Extract<RetainedCompilation, { kind: 'recipe' }>;
type CompilationSource = Parameters<typeof compilePreviewMeasurementProposal>[0]['source'];
type CompiledProposal = Extract<ReturnType<typeof compilePreviewMeasurementProposal>, { status: 'compiled' }>;
type Rejected = { status: 'rejected'; reason: string };

/**
 * The retained expansions the preview names, in the order the loop admitted them, which is the
 * order the planner builds its recipe steps in, so each step's prefix is a prefix of this batch.
 */
function resolveRecipes(
    input: ExecutePreviewMeasurementInput,
    recipeCallIds: readonly string[]
): { status: 'resolved'; recipes: RetainedRecipe[] } | Rejected {
    const retained = input.preview.retainedCompilations ?? [];
    for (const callId of recipeCallIds) {
        const entry = retained.find(
            (candidate): candidate is RetainedRecipe => candidate.callId === callId && candidate.kind === 'recipe'
        );
        if (entry === undefined) {
            return {
                status: 'rejected',
                reason: `The recipe call id "${callId}" must name a successful earlier-turn recipe expansion admitted in this run at the measurement revision.`,
            };
        }
        if (entry.revision !== input.projectRevision) {
            return {
                status: 'rejected',
                reason: `The recipe expansion "${callId}" was admitted at another revision than this measurement's; every expansion a preview holds must be at the measurement revision.`,
            };
        }
    }
    const recipes = retained.filter(
        (entry): entry is RetainedRecipe => entry.kind === 'recipe' && recipeCallIds.includes(entry.callId)
    );
    return { status: 'resolved', recipes };
}

/**
 * The sources the preview measures, the whole batch last. One recipe or a semantic list is one
 * source. Several recipes are measured at every cumulative prefix too, because admission reads each
 * recipe step's goals between that step's own prefixes, never across the whole batch alone.
 */
function previewSources(
    input: ExecutePreviewMeasurementInput
): { status: 'resolved'; sources: CompilationSource[]; adoptedRecipes?: AdoptedRecipe[] } | Rejected {
    if ('proposal' in input.source) {
        return { status: 'resolved', sources: [{ proposal: input.source.proposal }] };
    }
    const resolved = resolveRecipes(input, input.source.recipeCallIds);
    if (resolved.status === 'rejected') {
        return resolved;
    }
    const [only, ...others] = resolved.recipes;
    if (only !== undefined && others.length === 0) {
        return { status: 'resolved', sources: [{ recipe: only }] };
    }
    return {
        status: 'resolved',
        sources: resolved.recipes.map((_recipe, index) => ({ retained: resolved.recipes.slice(0, index + 1) })),
        adoptedRecipes: resolved.recipes.map((entry) => entry.recipe),
    };
}

function compileSource(input: ExecutePreviewMeasurementInput, source: CompilationSource): CompiledProposal | Rejected {
    try {
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
        return { status: 'rejected', reason: error instanceof Error ? error.message : String(error) };
    }
}

type CompiledProposals = { status: 'compiled'; batches: CompiledProposal[]; adoptedRecipes?: AdoptedRecipe[] };

/** Every batch the preview renders, the whole batch last; a refusal of any compiles none. */
function compileProposals(input: ExecutePreviewMeasurementInput): CompiledProposals | Rejected {
    if (input.preview.preparedBatch !== undefined) {
        const prepared = compileSource(input, { preparedBatch: input.preview.preparedBatch });
        return prepared.status === 'rejected' ? prepared : { status: 'compiled', batches: [prepared] };
    }
    const sources = previewSources(input);
    if (sources.status === 'rejected') {
        return sources;
    }
    const batches: CompiledProposal[] = [];
    for (const source of sources.sources) {
        const compiled = compileSource(input, source);
        if (compiled.status === 'rejected') {
            return compiled;
        }
        batches.push(compiled);
    }
    return sources.adoptedRecipes === undefined
        ? { status: 'compiled', batches }
        : { status: 'compiled', batches, adoptedRecipes: sources.adoptedRecipes };
}

async function renderPreview(
    input: ExecutePreviewMeasurementInput,
    preview: PreparedPreview,
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

type PreparedPreview = Extract<ReturnType<typeof previewVersionedCommandBatchEnvelope>, { status: 'previewed' }>;
type MeasuredBatch = {
    batch: CompiledProposal;
    rendered: RenderedPreview;
    pairs: Array<[RenderedTarget, RenderedTarget]>;
    targets: MeasuredPreview['targets'];
};

/** Render one batch's scope against the live project, then reduce each target's pair of renders. */
async function renderAndReduce(
    input: ExecutePreviewMeasurementInput,
    batch: CompiledProposal,
    preview: PreparedPreview,
    beats: MeasuredPreview['range'],
    run: MeasurementRun
): Promise<{ status: 'measured'; measured: MeasuredBatch } | { status: 'failed'; failure: PreviewMeasurementFailure }> {
    const rendered = await renderPreview(input, preview, beats, run);
    if (rendered.status === 'cancelled') {
        return { status: 'failed', failure: describeMeasurementStop(run.stopReason() ?? 'cancelled') };
    }
    if (rendered.status === 'refused') {
        return { status: 'failed', failure: previewRefusalFailure(rendered) };
    }
    const pairs = pairTargets(rendered);
    if (pairs === null) {
        return {
            status: 'failed',
            failure: {
                code: 'preview-unavailable',
                safeMessage: 'The project and the preview rendered different targets for this scope.',
                retryable: false,
            },
        };
    }
    const reduction = await reduceMeasuredTargets({
        targets: pairs,
        run,
        reduce: ([baseline, previewTarget]) => measurePreviewTarget(baseline, previewTarget, input.parsed.metrics),
    });
    if (reduction.status === 'stopped') {
        return { status: 'failed', failure: describeMeasurementStop(reduction.reason) };
    }
    return { status: 'measured', measured: { batch, rendered, pairs, targets: reduction.reduced } };
}

/** Each batch's isolated workspace, in order; one that cannot be prepared releases those before it. */
type PreparedBatch = { batch: CompiledProposal; preview: PreparedPreview };

function prepareWorkspaces(
    batches: readonly CompiledProposal[]
): { status: 'prepared'; prepared: PreparedBatch[] } | { status: 'failed'; failure: PreviewMeasurementFailure } {
    const prepared: PreparedBatch[] = [];
    for (const batch of batches) {
        const preview = previewVersionedCommandBatchEnvelope(batch.envelope);
        if (preview.status !== 'previewed') {
            releaseWorkspaces(prepared);
            return {
                status: 'failed',
                failure: previewFailure(preview.status, 'reason' in preview ? preview.reason : undefined),
            };
        }
        prepared.push({ batch, preview });
    }
    return { status: 'prepared', prepared };
}

function releaseWorkspaces(prepared: readonly PreparedBatch[]): void {
    for (const { preview } of prepared) {
        preview.resource.release();
    }
}

/** Render and reduce every batch in order; the first that stops ends the measurement and releases the rest. */
async function measureBatches(
    input: ExecutePreviewMeasurementInput,
    prepared: readonly PreparedBatch[],
    adoptedRecipes: CompiledProposals['adoptedRecipes'],
    beats: MeasuredPreview['range'],
    run: MeasurementRun
): Promise<AnalysisMeasureRead> {
    const measured: MeasuredBatch[] = [];
    for (const [index, { batch, preview }] of prepared.entries()) {
        const result = await renderAndReduce(input, batch, preview, beats, run);
        if (result.status === 'failed') {
            releaseWorkspaces(prepared.slice(index + 1));
            return failure(input, result.failure);
        }
        measured.push(result.measured);
    }
    // Retained only now every batch reports, so one that stops or throws first leaves the store as it was.
    const retentionWarnings = retainAgentMeasurementRenders({
        renders: measured.flatMap((entry) => renderedRenders(entry.rendered)),
        sourceRevision: input.projectRevision,
    });
    const reads = measured.map((entry) =>
        successRead(input, entry.rendered, entry.pairs, {
            beats,
            commands: entry.batch.commands,
            recipeSource: entry.batch.recipeSource,
            batchContentHash: digestCommandBatchContent(entry.batch.envelope),
            targets: entry.targets,
            retentionWarnings,
        })
    );
    const prefixes = reads.slice(0, -1);
    const whole = reads.at(-1);
    if (whole === undefined || adoptedRecipes === undefined) {
        return (
            whole ??
            failure(input, {
                code: 'preview-unavailable',
                safeMessage: 'The preview measured no batch.',
                retryable: false,
            })
        );
    }
    return {
        ...whole,
        prefixPreviews: prefixes.flatMap((read) => (read.measuredPreview === null ? [] : [read.measuredPreview])),
        adoptedRecipes,
    };
}

/**
 * Measure a semantic list or one or more retained recipes without applying them: compile and ground
 * them as a proposal would be, preview the resulting batch in an isolated workspace, render the
 * scope over the same range for the live project and for that preview, and reduce both to figures
 * and per-metric deltas. Several recipes are one cumulative batch in the order the loop admitted
 * them, and each shorter prefix of it is measured beside it, so every recipe step's goals are read
 * between its own prefixes. The commands measured are returned for the loop to retain under this
 * call id, so a later proposal adopts exactly what was measured. Every refusal is a typed failure
 * receipt, and nothing here writes the live project.
 */
export async function executePreviewMeasurement(input: ExecutePreviewMeasurementInput): Promise<AnalysisMeasureRead> {
    const resolved = resolveAnalysisMeasureBeats(input.parsed.range, input.sections);
    if (resolved.status === 'failure') {
        return failure(input, resolved.failure);
    }
    const compiled = compileProposals(input);
    if (compiled.status === 'rejected') {
        return failure(input, { code: 'preview-proposal-rejected', safeMessage: compiled.reason, retryable: true });
    }
    const workspaces = prepareWorkspaces(compiled.batches);
    if (workspaces.status === 'failed') {
        return failure(input, workspaces.failure);
    }
    const perBatch = planMeasurementWork({ scope: input.parsed.scope, subject: 'preview' });
    const started = beginMeasurementRun({
        admit: input.admit,
        planned: {
            renderJobs: perBatch.renderJobs * compiled.batches.length,
            analyses: perBatch.analyses * compiled.batches.length,
        },
        runSignal: input.signal,
        renderedSeconds: readMeasurementRenderedSeconds(resolved.beats.endBeat),
    });
    if (started.status === 'refused') {
        releaseWorkspaces(workspaces.prepared);
        return failure(input, started.failure);
    }
    try {
        return await measureBatches(input, workspaces.prepared, compiled.adoptedRecipes, resolved.beats, started.run);
    } finally {
        started.run.settle();
    }
}
